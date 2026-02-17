import { defineBackground } from 'wxt/utils/define-background';
import { handleRpcRequest } from '../lib/background/rpc-handler.js';
import {
  getState,
  setState,
  notifyAccountsChanged,
  notifyChainChanged,
} from '../lib/background/state.js';
import {
  fetchAllOperators,
  getCachedOperators,
  isStale,
  isModuleAvailable,
  getModuleAvailabilityCache,
  setModuleAvailabilityCache,
} from '../lib/background/operator-cache.js';
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../lib/shared/networks.js';
import { errorMessage } from '../lib/shared/errors.js';
import type { ModuleType, WalletState } from '../lib/shared/types.js';
import {
  PORT_NAME,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type PopupCommand,
  type PopupEvent,
} from '../lib/shared/messages.js';
import { isAddress, getAddress, type Address } from 'viem';

function assertAddress(value: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
}

function isValidRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  // ── RPC requests from content scripts ──
  chrome.runtime.onMessage.addListener(
    (message: RpcRequestMessage, sender, sendResponse) => {
      if (message.type !== 'rpc-request') return false;
      if (!sender.tab?.id) return false;

      handleRpcRequest(message.method, message.params)
        .then(async (response) => {
          // Dapp-initiated chain switch — sync popup state
          if (message.method === 'wallet_switchEthereumChain' && !response.error) {
            const state = await getState();
            broadcastToPopups({ type: 'state-update', state });
          }
          sendResponse({
            type: 'rpc-response',
            ...response,
          } satisfies RpcResponseMessage);
        })
        .catch((err: unknown) => {
          sendResponse({
            type: 'rpc-response',
            error: { code: -32603, message: errorMessage(err) },
          } satisfies RpcResponseMessage);
        });

      return true; // async response
    },
  );

  // ── Popup port connections ──
  const popupPorts = new Set<chrome.runtime.Port>();

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    popupPorts.add(port);
    port.onDisconnect.addListener(() => popupPorts.delete(port));

    port.onMessage.addListener(async (command: PopupCommand) => {
      try {
        await handlePopupCommand(command, port);
      } catch (err: unknown) {
        sendToPort(port, { type: 'error', message: errorMessage(err) });
      }
    });
  });

  function broadcastToPopups(event: PopupEvent) {
    for (const port of popupPorts) {
      sendToPort(port, event);
    }
  }

  function sendToPort(port: chrome.runtime.Port, event: PopupEvent) {
    try {
      port.postMessage(event);
    } catch {
      popupPorts.delete(port);
    }
  }

  /** Send cached operators and auto-refresh if stale */
  async function triggerRefresh(
    moduleType: ModuleType,
    chainId: SupportedChainId,
    state: WalletState,
  ) {
    const cached = await getCachedOperators(moduleType, chainId);
    if (cached) {
      broadcastToPopups({
        type: 'operators-update',
        chainId,
        moduleType,
        operators: cached.operators,
        lastFetchedAt: cached.lastFetchedAt,
      });

      if (!isStale(cached)) return;
    }

    // Fetch fresh data
    broadcastToPopups({ type: 'operators-loading', chainId, moduleType, loading: true });
    try {
      const entry = await fetchAllOperators(
        moduleType,
        chainId,
        state.customRpcUrls[chainId],
      );
      broadcastToPopups({
        type: 'operators-update',
        chainId,
        moduleType,
        operators: entry.operators,
        lastFetchedAt: entry.lastFetchedAt,
      });
    } catch (err: unknown) {
      broadcastToPopups({
        type: 'error',
        message: `Failed to fetch operators: ${errorMessage(err)}`,
      });
    } finally {
      broadcastToPopups({ type: 'operators-loading', chainId, moduleType, loading: false });
    }
  }

  /** Send persisted module availability immediately, then recheck via RPC. */
  async function sendPersistedAvailability(chainId: SupportedChainId, port?: chrome.runtime.Port) {
    const cached = await getModuleAvailabilityCache(chainId);
    if (cached) {
      const event: PopupEvent = { type: 'module-availability', modules: cached };
      if (port) sendToPort(port, event); else broadcastToPopups(event);
    }
  }

  /** Check CM availability via RPC, persist result, and broadcast. */
  async function checkModuleAvailability(chainId: SupportedChainId, customRpcUrl?: string) {
    const cmAvailable = await isModuleAvailable('cm', chainId, customRpcUrl);
    const modules = { csm: true, cm: cmAvailable };
    await setModuleAvailabilityCache(chainId, modules);
    broadcastToPopups({ type: 'module-availability', modules });
    return cmAvailable;
  }

  async function handlePopupCommand(
    command: PopupCommand,
    port: chrome.runtime.Port,
  ) {
    switch (command.type) {
      case 'get-state': {
        const state = await getState();
        sendToPort(port, { type: 'state-update', state });

        const chainId = state.chainId as SupportedChainId;
        if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
          await sendPersistedAvailability(chainId, port);
          checkModuleAvailability(chainId, state.customRpcUrls[chainId]).catch(() => {});
          await triggerRefresh(state.moduleType, chainId, state);
        }
        break;
      }

      case 'select-address': {
        assertAddress(command.address);
        const state = await setState({
          selectedAddress: {
            address: command.address,
            source: command.source,
          },
          isConnected: true,
        });
        broadcastToPopups({ type: 'state-update', state });
        await notifyAccountsChanged([command.address]);
        break;
      }

      case 'disconnect': {
        const state = await setState({
          selectedAddress: null,
          isConnected: false,
        });
        broadcastToPopups({ type: 'state-update', state });
        await notifyAccountsChanged([]);
        break;
      }

      case 'switch-network': {
        const state = await setState({ chainId: command.chainId });
        broadcastToPopups({ type: 'state-update', state });
        await notifyChainChanged(command.chainId);

        const chainId = command.chainId as SupportedChainId;
        if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
          await sendPersistedAvailability(chainId);
          checkModuleAvailability(chainId, state.customRpcUrls[chainId]).catch(() => {});
        }
        break;
      }

      case 'switch-module': {
        const state = await setState({
          moduleType: command.moduleType,
          selectedAddress: null,
          isConnected: false,
        });
        broadcastToPopups({ type: 'state-update', state });
        await notifyAccountsChanged([]);
        break;
      }

      case 'request-operators': {
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const currentState = await getState();
        await triggerRefresh(command.moduleType, chainId, currentState);
        break;
      }

      case 'refresh-operators': {
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;

        broadcastToPopups({
          type: 'operators-loading',
          chainId,
          moduleType: command.moduleType,
          loading: true,
        });

        try {
          const currentState = await getState();
          const entry = await fetchAllOperators(
            command.moduleType,
            chainId,
            currentState.customRpcUrls[chainId],
          );

          broadcastToPopups({
            type: 'operators-update',
            chainId,
            moduleType: command.moduleType,
            operators: entry.operators,
            lastFetchedAt: entry.lastFetchedAt,
          });
        } catch (err: unknown) {
          broadcastToPopups({
            type: 'error',
            message: `Failed to fetch operators: ${errorMessage(err)}`,
          });
        } finally {
          broadcastToPopups({
            type: 'operators-loading',
            chainId,
            moduleType: command.moduleType,
            loading: false,
          });
        }
        break;
      }

      case 'toggle-favorite': {
        const state = await getState();
        const favKey = `${state.moduleType}:${state.chainId}:${command.operatorId}`;
        const favorites = state.favorites.includes(favKey)
          ? state.favorites.filter((id) => id !== favKey)
          : [...state.favorites, favKey];
        const updated = await setState({ favorites });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }

      case 'add-manual-address': {
        assertAddress(command.address);
        const normalized = getAddress(command.address);
        const state = await getState();
        if (!state.manualAddresses.some((a) => getAddress(a) === normalized)) {
          const updated = await setState({
            manualAddresses: [
              ...state.manualAddresses,
              normalized,
            ],
          });
          broadcastToPopups({ type: 'state-update', state: updated });
        }
        break;
      }

      case 'remove-manual-address': {
        const state = await getState();
        const normalized = getAddress(command.address);
        const updated = await setState({
          manualAddresses: state.manualAddresses.filter(
            (a) => getAddress(a) !== normalized,
          ),
        });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }

      case 'set-custom-rpc': {
        if (command.rpcUrl && !isValidRpcUrl(command.rpcUrl)) {
          throw new Error('Invalid RPC URL');
        }
        const state = await getState();
        const customRpcUrls = { ...state.customRpcUrls };
        if (command.rpcUrl) {
          customRpcUrls[command.chainId] = command.rpcUrl;
        } else {
          delete customRpcUrls[command.chainId];
        }
        const updated = await setState({ customRpcUrls });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }
    }
  }
});
