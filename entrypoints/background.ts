import { defineBackground } from 'wxt/utils/define-background';
import { handleRpcRequest } from '../lib/background/rpc-handler.js';
import {
  getSiteState,
  setSiteState,
  getGlobalSettings,
  setGlobalSettings,
  getComposedState,
  notifyAccountsChanged,
  notifyChainChanged,
  resetCaches,
} from '../lib/background/state.js';

if (typeof self !== 'undefined') Object.assign(self, { __resetStateCaches: resetCaches });
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
import type { CacheContext, SiteState, GlobalSettings } from '../lib/shared/types.js';
import {
  PORT_NAME,
  type RpcRequestMessage,
  type RpcResponseMessage,
  type PopupCommand,
  type PopupEvent,
  type ApprovalResponse,
} from '../lib/shared/messages.js';
import { requestApproval, type PendingApproval } from '../lib/background/approval.js';
import { getSigningMode } from '../lib/background/test-rpc.js';
import { isAddress, getAddress, type Address } from 'viem';

function assertAddress(value: string): asserts value is Address {
  if (!isAddress(value)) throw new Error(`Invalid address: ${value}`);
}

function buildContext(
  siteState: SiteState,
  globalSettings: GlobalSettings,
  forkedFrom: SupportedChainId | null,
): CacheContext {
  const isAnvil = siteState.chainId === ANVIL_CHAIN_ID;
  const chainId = isAnvil ? ANVIL_CHAIN_ID : siteState.chainId;
  const rpcUrl = isAnvil
    ? (globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl)
    : (globalSettings.customRpcUrls[siteState.chainId] ?? DEFAULT_NETWORKS[siteState.chainId as SupportedChainId]?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl);

  return {
    chainId,
    moduleType: siteState.moduleType,
    rpcUrl,
    ...(isAnvil && forkedFrom ? { forkedFrom } : {}),
  };
}

export default defineBackground(() => {
  // ── Approval state ──
  const pendingApprovals = new Map<string, PendingApproval>();

  // ── Connection prompt state (keyed by origin) ──
  type PendingConnection = {
    promise: Promise<Address[]>;
    resolve: (addresses: Address[]) => void;
    windowId: number;
  };
  const pendingConnections = new Map<string, PendingConnection>();

  async function requestConnection(origin: string): Promise<Address[]> {
    const existing = pendingConnections.get(origin);
    if (existing) {
      chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
      return existing.promise;
    }

    const params = new URLSearchParams({ origin });
    const url = chrome.runtime.getURL(`popup.html?${params.toString()}`);
    const win = await chrome.windows.create({
      url,
      type: 'popup',
      width: 400,
      height: 600,
      focused: true,
    });

    if (!win?.id) return [];
    const windowId = win.id;

    let resolve!: (addresses: Address[]) => void;
    const promise = new Promise<Address[]>((r) => { resolve = r; });
    pendingConnections.set(origin, { promise, resolve, windowId });

    const onRemoved = (removedId: number) => {
      if (removedId !== windowId) return;
      chrome.windows.onRemoved.removeListener(onRemoved);
      if (pendingConnections.has(origin)) {
        pendingConnections.delete(origin);
        resolve([]);
      }
    };
    chrome.windows.onRemoved.addListener(onRemoved);

    return promise;
  }

  const SIGNING_METHODS = new Set([
    'eth_sendTransaction',
    'eth_signTypedData_v4',
    'eth_signTypedData',
    'personal_sign',
    'eth_sign',
  ]);

  async function handleWithApproval(origin: string, method: string, params?: unknown[]) {
    // Connection prompt for new/unconnected origins
    if (method === 'eth_requestAccounts') {
      const siteState = await getSiteState(origin);
      if (!siteState.selectedAddress) {
        const addresses = await requestConnection(origin);
        return { result: addresses };
      }
    }

    if (SIGNING_METHODS.has(method)) {
      const mode = getSigningMode();
      if (mode === 'reject') {
        return { error: { code: 4001, message: 'CSM Dev Wallet: User rejected the request' } };
      }
      if (mode === 'error') {
        return { error: { code: -32603, message: 'CSM Dev Wallet: Simulated RPC error' } };
      }
      if (mode !== 'approve') {
        // mode === 'prompt' — use existing approval popup flow
        const siteState = await getSiteState(origin);
        const globalSettings = await getGlobalSettings();
        if (globalSettings.requireApproval && siteState.chainId === ANVIL_CHAIN_ID && siteState.selectedAddress) {
          const approved = await requestApproval(method, siteState.selectedAddress.address, pendingApprovals);
          if (!approved) {
            return { error: { code: 4001, message: 'CSM Dev Wallet: User rejected the request' } };
          }
        }
      }
      // mode === 'approve' falls through — no popup, direct execution
    }
    return handleRpcRequest(method, params, origin);
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

      const origin = message.origin;

      handleWithApproval(origin, message.method, message.params)
        .then(async (response) => {
          // Dapp-initiated chain switch — sync popup state
          if (message.method === 'wallet_switchEthereumChain' && !response.error) {
            const state = await getComposedState(origin);
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
    const globalSettings = await getGlobalSettings();
    const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;

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
        const { origin } = command;
        let siteState = await getSiteState(origin);
        let state = await getComposedState(origin);
        sendToPort(port, { type: 'state-update', state });

        const globalSettings = await getGlobalSettings();

        if (siteState.chainId === ANVIL_CHAIN_ID) {
          const { forkedFrom } = await handleAnvilInit(port);
          if (forkedFrom) {
            const ctx = buildContext(siteState, globalSettings, forkedFrom);
            await sendPersistedAvailability(ctx.chainId, port);
            checkModuleAvailability(ctx).catch(() => {});
            await triggerRefresh(ctx);
          } else {
            // Anvil selected but fork detection failed — switch to Mainnet
            siteState = await setSiteState(origin, { chainId: CHAIN_ID.Mainnet });
            state = await getComposedState(origin);
            sendToPort(port, { type: 'state-update', state });
            await notifyChainChanged(origin, CHAIN_ID.Mainnet);
          }
          handleAnvilInit(port).catch(() => {});
        } else {
          const chainId = siteState.chainId as SupportedChainId;
          if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
            const ctx = buildContext(siteState, globalSettings, null);
            await sendPersistedAvailability(ctx.chainId, port);
            checkModuleAvailability(ctx).catch(() => {});
            await triggerRefresh(ctx);
          }
          handleAnvilInit(port).catch(() => {});
        }
        break;
      }

      case 'select-address': {
        const { origin } = command;
        assertAddress(command.address);
        await setSiteState(origin, {
          selectedAddress: {
            address: command.address,
            source: command.source,
          },
          isConnected: true,
        });
        const state = await getComposedState(origin);
        broadcastToPopups({ type: 'state-update', state });
        await notifyAccountsChanged(origin, [command.address]);

        // Resolve pending connection prompt if one exists for this origin
        const pending = pendingConnections.get(origin);
        if (pending) {
          pendingConnections.delete(origin);
          pending.resolve([command.address as Address]);
          chrome.windows.remove(pending.windowId).catch(() => {});
        }
        break;
      }

      case 'disconnect': {
        const { origin } = command;
        await setSiteState(origin, {
          selectedAddress: null,
          isConnected: false,
        });
        const state = await getComposedState(origin);
        broadcastToPopups({ type: 'state-update', state });
        await notifyAccountsChanged(origin, []);
        break;
      }

      case 'switch-network': {
        const { origin } = command;
        const siteState = await setSiteState(origin, { chainId: command.chainId });
        const state = await getComposedState(origin);
        broadcastToPopups({ type: 'state-update', state });

        const globalSettings = await getGlobalSettings();

        if (command.chainId === ANVIL_CHAIN_ID) {
          const { forkedFrom } = await handleAnvilInit();
          if (forkedFrom) {
            await notifyChainChanged(origin, forkedFrom);
            const ctx = buildContext(siteState, globalSettings, forkedFrom);
            await sendPersistedAvailability(ctx.chainId);
            checkModuleAvailability(ctx).catch(() => {});
          }
        } else {
          await clearForkedFrom();
          await notifyChainChanged(origin, command.chainId);
          const chainId = command.chainId as SupportedChainId;
          if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
            const ctx = buildContext(siteState, globalSettings, null);
            await sendPersistedAvailability(ctx.chainId);
            checkModuleAvailability(ctx).catch(() => {});
          }
          handleAnvilInit().catch(() => {});
        }
        break;
      }

      case 'switch-module': {
        const { origin } = command;
        await setSiteState(origin, { moduleType: command.moduleType });
        const state = await getComposedState(origin);
        broadcastToPopups({ type: 'state-update', state });
        break;
      }

      case 'request-operators': {
        const globalSettings = await getGlobalSettings();
        if (command.chainId === ANVIL_CHAIN_ID) {
          const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
          let forkedFrom = await getForkedFrom();
          if (!forkedFrom) {
            forkedFrom = await detectAnvilFork(rpcUrl);
            if (forkedFrom) await setForkedFrom(forkedFrom);
          }
          if (forkedFrom) {
            const ctx: CacheContext = {
              chainId: ANVIL_CHAIN_ID,
              moduleType: command.moduleType,
              rpcUrl,
              forkedFrom,
            };
            await triggerRefresh(ctx);
          }
          break;
        }
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const rpcUrl = globalSettings.customRpcUrls[command.chainId] ?? DEFAULT_NETWORKS[chainId]?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl;
        await triggerRefresh({ chainId: command.chainId, moduleType: command.moduleType, rpcUrl });
        break;
      }

      case 'refresh-operators': {
        const globalSettings = await getGlobalSettings();
        if (command.chainId === ANVIL_CHAIN_ID) {
          const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
          let forkedFrom = await getForkedFrom();
          if (!forkedFrom) {
            forkedFrom = await detectAnvilFork(rpcUrl);
            if (forkedFrom) await setForkedFrom(forkedFrom);
          }
          if (forkedFrom) {
            const ctx: CacheContext = {
              chainId: ANVIL_CHAIN_ID,
              moduleType: command.moduleType,
              rpcUrl,
              forkedFrom,
            };
            await triggerRefresh(ctx, true);
          }
          break;
        }
        const chainId = command.chainId as SupportedChainId;
        if (!SUPPORTED_CHAIN_IDS.includes(chainId)) break;
        const rpcUrl = globalSettings.customRpcUrls[command.chainId] ?? DEFAULT_NETWORKS[chainId]?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl;
        await triggerRefresh({ chainId: command.chainId, moduleType: command.moduleType, rpcUrl }, true);
        break;
      }

      case 'toggle-favorite': {
        const { origin } = command;
        const siteState = await getSiteState(origin);
        const globalSettings = await getGlobalSettings();
        const forkedFrom = await getForkedFrom();
        const chainIdForFavorites = (siteState.chainId === ANVIL_CHAIN_ID && forkedFrom)
          ? forkedFrom
          : siteState.chainId;
        const favorites = toggleFavorite(globalSettings.favorites, siteState.moduleType, chainIdForFavorites, command.operatorId);
        await setGlobalSettings({ favorites });
        const state = await getComposedState(origin);
        broadcastToPopups({ type: 'state-update', state });
        break;
      }

      case 'add-manual-address': {
        assertAddress(command.address);
        const normalized = getAddress(command.address);
        const globalSettings = await getGlobalSettings();
        if (!globalSettings.manualAddresses.some((a) => getAddress(a) === normalized)) {
          await setGlobalSettings({
            manualAddresses: [...globalSettings.manualAddresses, normalized],
          });
          const state = await getComposedState(command.origin);
          broadcastToPopups({ type: 'state-update', state });
        }
        break;
      }

      case 'remove-manual-address': {
        const globalSettings = await getGlobalSettings();
        const normalized = getAddress(command.address);
        await setGlobalSettings({
          manualAddresses: globalSettings.manualAddresses.filter(
            (a) => getAddress(a) !== normalized,
          ),
        });
        const state = await getComposedState(command.origin);
        broadcastToPopups({ type: 'state-update', state });
        break;
      }

      case 'set-address-label': {
        assertAddress(command.address);
        const globalSettings = await getGlobalSettings();
        const addressLabels = { ...globalSettings.addressLabels };
        const key = command.address.toLowerCase();
        if (command.label.trim()) {
          addressLabels[key] = command.label.trim();
        } else {
          delete addressLabels[key];
        }
        await setGlobalSettings({ addressLabels });
        const state = await getComposedState(command.origin);
        broadcastToPopups({ type: 'state-update', state });
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
        const globalSettings = await getGlobalSettings();
        const customRpcUrls = { ...globalSettings.customRpcUrls };
        if (command.rpcUrl) {
          customRpcUrls[command.chainId] = command.rpcUrl;
        } else {
          delete customRpcUrls[command.chainId];
        }
        await setGlobalSettings({ customRpcUrls });
        const state = await getComposedState(command.origin);
        broadcastToPopups({ type: 'state-update', state });
        break;
      }

      case 'set-require-approval': {
        await setGlobalSettings({ requireApproval: command.enabled });
        const state = await getComposedState(command.origin);
        broadcastToPopups({ type: 'state-update', state });
        break;
      }
    }
  }
});
