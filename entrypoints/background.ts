import { defineBackground } from 'wxt/utils/define-background';
import { handleRpcRequest } from '../lib/background/rpc-handler.js';
import {
  getState,
  setState,
  notifyAccountsChanged,
  notifyChainChanged,
} from '../lib/background/state.js';
import {
  fetchOperators,
  getCachedOperators,
  isStale,
  isModuleAvailable,
  getModuleAvailabilityCache,
  setModuleAvailabilityCache,
} from '../lib/background/operator-cache.js';
import {
  detectAnvilFork,
  getAnvilAccounts,
  getForkedFrom,
  setForkedFrom,
  clearForkedFrom,
} from '../lib/background/anvil.js';
import { CHAIN_ID, SUPPORTED_CHAIN_IDS, ANVIL_CHAIN_ID, ANVIL_NETWORK, DEFAULT_NETWORKS, type SupportedChainId } from '../lib/shared/networks.js';
import { errorMessage } from '../lib/shared/errors.js';
import { toggleFavorite } from '../lib/shared/favorites.js';
import type { CacheContext, WalletState } from '../lib/shared/types.js';
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

function buildContext(
  state: WalletState,
  forkedFrom: SupportedChainId | null,
): CacheContext {
  const isAnvil = state.chainId === ANVIL_CHAIN_ID;
  const chainId = isAnvil ? ANVIL_CHAIN_ID : state.chainId;
  const rpcUrl = isAnvil
    ? (state.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl)
    : (state.customRpcUrls[state.chainId] ?? DEFAULT_NETWORKS[state.chainId as SupportedChainId]?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl);

  return {
    chainId,
    moduleType: state.moduleType,
    rpcUrl,
    ...(isAnvil && forkedFrom ? { forkedFrom } : {}),
  };
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
    return handleRpcRequest(method, params);
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

  async function handleAnvilInit(port?: chrome.runtime.Port) {
    const state = await getState();
    const rpcUrl = state.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;

    const forkedFrom = await detectAnvilFork(rpcUrl);
    if (forkedFrom) {
      await setForkedFrom(forkedFrom);
    } else {
      await clearForkedFrom();
    }
    const accounts = forkedFrom ? await getAnvilAccounts(rpcUrl) : [];

    const event: PopupEvent = { type: 'anvil-status', forkedFrom, accounts };
    if (port) sendToPort(port, event); else broadcastToPopups(event);

    return { forkedFrom };
  }

  /** Send cached operators and auto-refresh if stale (or forced) */
  async function triggerRefresh(ctx: CacheContext, force = false) {
    const cached = await getCachedOperators(ctx);
    if (cached) {
      broadcastToPopups({
        type: 'operators-update',
        chainId: ctx.chainId,
        moduleType: ctx.moduleType,
        operators: cached.operators,
        lastFetchedAt: cached.lastFetchedAt,
      });
      if (!force && !isStale(cached)) return;
    }

    broadcastToPopups({ type: 'operators-loading', chainId: ctx.chainId, moduleType: ctx.moduleType, loading: true });
    try {
      const entry = await fetchOperators(ctx);
      broadcastToPopups({
        type: 'operators-update',
        chainId: ctx.chainId,
        moduleType: ctx.moduleType,
        operators: entry.operators,
        lastFetchedAt: entry.lastFetchedAt,
      });
    } catch (err: unknown) {
      broadcastToPopups({
        type: 'error',
        message: `Failed to fetch operators: ${errorMessage(err)}`,
      });
    } finally {
      broadcastToPopups({ type: 'operators-loading', chainId: ctx.chainId, moduleType: ctx.moduleType, loading: false });
    }
  }

  /** Send persisted module availability immediately, then recheck via RPC. */
  async function sendPersistedAvailability(chainId: number, port?: chrome.runtime.Port) {
    const cached = await getModuleAvailabilityCache(chainId);
    if (cached) {
      const event: PopupEvent = { type: 'module-availability', modules: cached };
      if (port) sendToPort(port, event); else broadcastToPopups(event);
    }
  }

  /** Check CM availability via RPC, persist result, and broadcast. */
  async function checkModuleAvailability(ctx: CacheContext) {
    const cmCtx: CacheContext = { ...ctx, moduleType: 'cm' };
    const cmAvailable = await isModuleAvailable(cmCtx);
    const modules = { csm: true, cm: cmAvailable };
    await setModuleAvailabilityCache(ctx.chainId, modules);
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
          const { forkedFrom } = await handleAnvilInit(port);
          if (forkedFrom) {
            const ctx = buildContext(state, forkedFrom);
            await sendPersistedAvailability(ctx.chainId, port);
            checkModuleAvailability(ctx).catch(() => {});
            await triggerRefresh(ctx);
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
            const ctx = buildContext(state, null);
            await sendPersistedAvailability(ctx.chainId, port);
            checkModuleAvailability(ctx).catch(() => {});
            await triggerRefresh(ctx);
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
          const { forkedFrom } = await handleAnvilInit();
          if (forkedFrom) {
            await notifyChainChanged(forkedFrom);
            const ctx = buildContext(state, forkedFrom);
            await sendPersistedAvailability(ctx.chainId);
            checkModuleAvailability(ctx).catch(() => {});
          }
        } else {
          await clearForkedFrom();
          await notifyChainChanged(command.chainId);
          const chainId = command.chainId as SupportedChainId;
          if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
            const ctx = buildContext(state, null);
            await sendPersistedAvailability(ctx.chainId);
            checkModuleAvailability(ctx).catch(() => {});
          }
          // Probe Anvil availability so dropdown knows before user selects it
          handleAnvilInit().catch(() => {});
        }
        break;
      }

      case 'switch-module': {
        const state = await setState({
          moduleType: command.moduleType,
        });
        broadcastToPopups({ type: 'state-update', state });
        break;
      }

      case 'request-operators': {
        const currentState = await getState();
        if (command.chainId === ANVIL_CHAIN_ID) {
          const rpcUrl = currentState.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
          let forkedFrom = await getForkedFrom();
          if (!forkedFrom) {
            forkedFrom = await detectAnvilFork(rpcUrl);
            if (forkedFrom) await setForkedFrom(forkedFrom);
          }
          if (forkedFrom) {
            const ctx = buildContext(currentState, forkedFrom);
            await triggerRefresh({ ...ctx, moduleType: command.moduleType });
          }
          break;
        }
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const ctx = buildContext(currentState, null);
        await triggerRefresh({ ...ctx, moduleType: command.moduleType });
        break;
      }

      case 'refresh-operators': {
        const currentState = await getState();
        if (command.chainId === ANVIL_CHAIN_ID) {
          const rpcUrl = currentState.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
          let forkedFrom = await getForkedFrom();
          if (!forkedFrom) {
            forkedFrom = await detectAnvilFork(rpcUrl);
            if (forkedFrom) await setForkedFrom(forkedFrom);
          }
          if (forkedFrom) {
            const ctx = buildContext(currentState, forkedFrom);
            await triggerRefresh({ ...ctx, moduleType: command.moduleType }, true);
          }
          break;
        }
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const ctx = buildContext(currentState, null);
        await triggerRefresh({ ...ctx, moduleType: command.moduleType }, true);
        break;
      }

      case 'toggle-favorite': {
        const state = await getState();
        const forkedFrom = await getForkedFrom();
        const chainIdForFavorites = (state.chainId === ANVIL_CHAIN_ID && forkedFrom)
          ? forkedFrom
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
