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
  fetchAnvilOperators,
  getCachedOperators,
  isStale,
  isModuleAvailable,
  getModuleAvailabilityCache,
  setModuleAvailabilityCache,
} from '../lib/background/operator-cache.js';
import { detectAnvilFork, getAnvilAccounts } from '../lib/background/anvil.js';
import { CHAIN_ID, SUPPORTED_CHAIN_IDS, ANVIL_CHAIN_ID, ANVIL_NETWORK, type SupportedChainId } from '../lib/shared/networks.js';
import { errorMessage } from '../lib/shared/errors.js';
import { toggleFavorite } from '../lib/shared/favorites.js';
import type { ModuleType, WalletState } from '../lib/shared/types.js';
import {
  PORT_NAME,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type PopupCommand,
  type PopupEvent,
  type ApprovalResponse,
} from '../lib/shared/messages.js';
import { requestApproval, type PendingApproval } from '../lib/background/approval.js';
import { isAddress, getAddress, type Address } from 'viem';

function assertAddress(value: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
}

export default defineBackground(() => {
  // ── Approval state ──
  const pendingApprovals = new Map<string, PendingApproval>();

  const SIGNING_METHODS = new Set([
    'eth_sendTransaction',
    'eth_signTypedData_v4',
    'eth_signTypedData',
    'personal_sign',
    'eth_sign',
  ]);

  async function handleWithApproval(method: string, params?: unknown[]) {
    if (SIGNING_METHODS.has(method)) {
      const state = await getState();
      if (state.requireApproval && state.chainId === ANVIL_CHAIN_ID && state.selectedAddress) {
        const approved = await requestApproval(method, state.selectedAddress.address, pendingApprovals);
        if (!approved) {
          return { error: { code: 4001, message: 'CSM Dev Wallet: User rejected the request' } };
        }
      }
    }
    return handleRpcRequest(method, params, anvilForkedFrom);
  }

  // ── RPC requests from content scripts ──
  chrome.runtime.onMessage.addListener(
    (message: RpcRequestMessage | ApprovalResponse, sender, sendResponse) => {
      // Handle approval response from approval window
      if (message.type === 'approval-response') {
        const pending = pendingApprovals.get(message.id);
        if (pending) {
          pendingApprovals.delete(message.id);
          chrome.windows.remove(pending.windowId).catch(() => {});
          pending.resolve(message.approved);
        }
        sendResponse({});
        return false;
      }

      if (message.type !== 'rpc-request') return false;
      if (!sender.tab?.id) return false;

      handleWithApproval(message.method, message.params)
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

  // ── Anvil fork state ──
  let anvilForkedFrom: SupportedChainId | null = null;

  async function handleAnvilInit(port?: chrome.runtime.Port) {
    const state = await getState();
    const rpcUrl = state.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;

    const forkedFrom = await detectAnvilFork(rpcUrl);
    anvilForkedFrom = forkedFrom;
    const accounts = forkedFrom ? await getAnvilAccounts(rpcUrl) : [];

    const event: PopupEvent = { type: 'anvil-status', forkedFrom, accounts };
    if (port) sendToPort(port, event); else broadcastToPopups(event);

    return { forkedFrom, rpcUrl };
  }

  async function triggerAnvilRefresh(
    moduleType: ModuleType,
    forkedFrom: SupportedChainId,
    anvilRpcUrl: string,
    force = false,
  ) {
    const cached = await getCachedOperators(moduleType, ANVIL_CHAIN_ID);
    if (cached) {
      broadcastToPopups({
        type: 'operators-update',
        chainId: ANVIL_CHAIN_ID,
        moduleType,
        operators: cached.operators,
        lastFetchedAt: cached.lastFetchedAt,
      });
      if (!force && !isStale(cached)) return;
    }

    broadcastToPopups({ type: 'operators-loading', chainId: ANVIL_CHAIN_ID, moduleType, loading: true });
    try {
      const entry = await fetchAnvilOperators(moduleType, forkedFrom, anvilRpcUrl);
      broadcastToPopups({
        type: 'operators-update',
        chainId: ANVIL_CHAIN_ID,
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
      broadcastToPopups({ type: 'operators-loading', chainId: ANVIL_CHAIN_ID, moduleType, loading: false });
    }
  }

  /** Send cached operators and auto-refresh if stale (or forced) */
  async function triggerRefresh(
    moduleType: ModuleType,
    chainId: SupportedChainId,
    state: WalletState,
    force = false,
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

      if (!force && !isStale(cached)) return;
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
        let state = await getState();
        sendToPort(port, { type: 'state-update', state });

        if (state.chainId === ANVIL_CHAIN_ID) {
          const { forkedFrom, rpcUrl } = await handleAnvilInit(port);
          if (forkedFrom) {
            await sendPersistedAvailability(forkedFrom, port);
            checkModuleAvailability(forkedFrom, rpcUrl).catch(() => {});
            await triggerAnvilRefresh(state.moduleType, forkedFrom, rpcUrl);
          } else {
            // Anvil selected but fork detection failed — switch to Mainnet
            state = await setState({ chainId: CHAIN_ID.Mainnet });
            sendToPort(port, { type: 'state-update', state });
            await notifyChainChanged(CHAIN_ID.Mainnet);
          }
          // Probe Anvil availability so dropdown knows before user selects it
          handleAnvilInit(port).catch(() => {});
        } else {
          const chainId = state.chainId as SupportedChainId;
          if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
            await sendPersistedAvailability(chainId, port);
            checkModuleAvailability(chainId, state.customRpcUrls[chainId]).catch(() => {});
            await triggerRefresh(state.moduleType, chainId, state);
          }
          // Probe Anvil availability so dropdown knows before user selects it
          handleAnvilInit(port).catch(() => {});
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

        if (command.chainId === ANVIL_CHAIN_ID) {
          const { forkedFrom, rpcUrl } = await handleAnvilInit();
          if (forkedFrom) {
            await notifyChainChanged(forkedFrom);
            await sendPersistedAvailability(forkedFrom);
            checkModuleAvailability(forkedFrom, rpcUrl).catch(() => {});
          }
        } else {
          await notifyChainChanged(command.chainId);
          const chainId = command.chainId as SupportedChainId;
          if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
            await sendPersistedAvailability(chainId);
            checkModuleAvailability(chainId, state.customRpcUrls[chainId]).catch(() => {});
          }
          // Probe Anvil availability so dropdown knows before user selects it
          handleAnvilInit().catch(() => {});
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
        if (command.chainId === ANVIL_CHAIN_ID) {
          const currentState = await getState();
          const rpcUrl = currentState.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
          const forkedFrom = anvilForkedFrom ?? await detectAnvilFork(rpcUrl);
          anvilForkedFrom = forkedFrom;
          if (forkedFrom) await triggerAnvilRefresh(command.moduleType, forkedFrom, rpcUrl);
          break;
        }
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const currentState = await getState();
        await triggerRefresh(command.moduleType, chainId, currentState);
        break;
      }

      case 'refresh-operators': {
        if (command.chainId === ANVIL_CHAIN_ID) {
          const currentState = await getState();
          const rpcUrl = currentState.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
          const forkedFrom = anvilForkedFrom ?? await detectAnvilFork(rpcUrl);
          anvilForkedFrom = forkedFrom;
          if (forkedFrom) await triggerAnvilRefresh(command.moduleType, forkedFrom, rpcUrl, true);
          break;
        }
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const currentState = await getState();
        await triggerRefresh(command.moduleType, chainId, currentState, true);
        break;
      }

      case 'toggle-favorite': {
        const state = await getState();
        const chainIdForFavorites = (state.chainId === ANVIL_CHAIN_ID && anvilForkedFrom)
          ? anvilForkedFrom
          : state.chainId;
        const favorites = toggleFavorite(state.favorites, state.moduleType, chainIdForFavorites, command.operatorId);
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

      case 'set-address-label': {
        assertAddress(command.address);
        const state = await getState();
        const addressLabels = { ...state.addressLabels };
        const key = command.address.toLowerCase();
        if (command.label.trim()) {
          addressLabels[key] = command.label.trim();
        } else {
          delete addressLabels[key];
        }
        const updated = await setState({ addressLabels });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }

      case 'set-custom-rpc': {
        if (command.rpcUrl) {
          try {
            const { protocol } = new URL(command.rpcUrl);
            if (protocol !== 'https:' && protocol !== 'http:')
              throw 0;
          } catch {
            throw new Error('Invalid RPC URL');
          }
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

      case 'set-require-approval': {
        const updated = await setState({ requireApproval: command.enabled });
        broadcastToPopups({ type: 'state-update', state: updated });
        break;
      }
    }
  }
});
