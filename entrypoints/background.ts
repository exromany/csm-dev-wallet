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
} from '../lib/background/operator-cache.js';
import { setKey, removeKey, hasKey } from '../lib/background/key-store.js';
import { SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../lib/shared/networks.js';
import type { ModuleType, WalletState } from '../lib/shared/types.js';
import {
  PORT_NAME,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type PopupCommand,
  type PopupEvent,
} from '../lib/shared/messages.js';
import { isAddress, type Address } from 'viem';

function assertAddress(value: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
}

function assertHexKey(value: string): asserts value is `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('Invalid private key format');
}

function isValidRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export default defineBackground(() => {
  // ── RPC requests from content scripts ──
  chrome.runtime.onMessage.addListener(
    (message: RpcRequestMessage, _sender, sendResponse) => {
      if (message.type !== 'rpc-request') return false;

      handleRpcRequest(message.method, message.params).then((response) => {
        sendResponse({
          type: 'rpc-response',
          ...response,
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
      } catch (err: any) {
        sendToPort(port, { type: 'error', message: err.message });
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
    } catch (err: any) {
      broadcastToPopups({
        type: 'error',
        message: `Failed to fetch operators: ${err.message}`,
      });
    } finally {
      broadcastToPopups({ type: 'operators-loading', chainId, moduleType, loading: false });
    }
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
          await triggerRefresh(state.moduleType, chainId, state);
        }
        break;
      }

      case 'select-address': {
        assertAddress(command.address);
        const canSign = await hasKey(command.address);
        const state = await setState({
          selectedAddress: {
            address: command.address,
            source: command.source,
            canSign,
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
          await triggerRefresh(state.moduleType, chainId, state);
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

        const chainId = state.chainId as SupportedChainId;
        if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
          await triggerRefresh(command.moduleType, chainId, state);
        }
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
        } catch (err: any) {
          broadcastToPopups({
            type: 'error',
            message: `Failed to fetch operators: ${err.message}`,
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
        const state = await getState();
        if (!state.manualAddresses.includes(command.address)) {
          const updated = await setState({
            manualAddresses: [
              ...state.manualAddresses,
              command.address,
            ],
          });
          broadcastToPopups({ type: 'state-update', state: updated });
        }
        break;
      }

      case 'remove-manual-address': {
        const state = await getState();
        const updated = await setState({
          manualAddresses: state.manualAddresses.filter(
            (a) => a.toLowerCase() !== command.address.toLowerCase(),
          ),
        });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }

      case 'import-key': {
        assertAddress(command.address);
        assertHexKey(command.privateKey);
        await setKey(command.address, command.privateKey);
        const state = await getState();
        if (
          state.selectedAddress?.address.toLowerCase() ===
          command.address.toLowerCase()
        ) {
          const updated = await setState({
            selectedAddress: { ...state.selectedAddress, canSign: true },
          });
          broadcastToPopups({ type: 'state-update', state: updated });
        }
        break;
      }

      case 'remove-key': {
        assertAddress(command.address);
        await removeKey(command.address);
        const state = await getState();
        if (
          state.selectedAddress?.address.toLowerCase() ===
          command.address.toLowerCase()
        ) {
          const updated = await setState({
            selectedAddress: { ...state.selectedAddress, canSign: false },
          });
          broadcastToPopups({ type: 'state-update', state: updated });
        }
        break;
      }

      case 'set-custom-rpc': {
        if (command.rpcUrl && !isValidRpcUrl(command.rpcUrl)) {
          throw new Error('RPC URL must use HTTPS or localhost');
        }
        const state = await getState();
        const customRpcUrls = {
          ...state.customRpcUrls,
          [command.chainId]: command.rpcUrl,
        };
                const updated = await setState({ customRpcUrls });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }
    }
  }
});
