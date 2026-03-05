import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeState, ADDR_A } from '../fixtures.js';

const TEST_ORIGIN = 'https://stake.lido.fi';

// ── Capture the callback passed to defineBackground ──
let backgroundFn: () => void;
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (fn: () => void) => { backgroundFn = fn; },
}));

// ── Module mocks ──
const getSiteState = vi.fn();
const setSiteState = vi.fn();
const getGlobalSettings = vi.fn();
const setGlobalSettings = vi.fn();
const getComposedState = vi.fn();
const notifyChainChanged = vi.fn().mockResolvedValue(undefined);
const notifyAccountsChanged = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/background/state.ts', () => ({
  getSiteState,
  setSiteState,
  getGlobalSettings,
  setGlobalSettings,
  getComposedState,
  notifyAccountsChanged,
  notifyChainChanged,
  resetCaches: vi.fn(),
}));

vi.mock('../../lib/background/anvil.ts', () => ({
  detectAnvilFork: vi.fn(),
  getAnvilAccounts: vi.fn(),
  withImpersonation: vi.fn(),
  getForkedFrom: vi.fn().mockResolvedValue(null),
  setForkedFrom: vi.fn().mockResolvedValue(undefined),
  clearForkedFrom: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/background/operator-cache.ts', () => ({
  fetchOperators: vi.fn(),
  getCachedOperators: vi.fn().mockResolvedValue(null),
  isStale: vi.fn().mockReturnValue(false),
  isModuleAvailable: vi.fn().mockResolvedValue(true),
  getModuleAvailabilityCache: vi.fn().mockResolvedValue(null),
  setModuleAvailabilityCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/background/rpc-handler.ts', () => ({
  handleRpcRequest: vi.fn(),
}));

vi.mock('../../lib/background/approval.ts', () => ({
  requestApproval: vi.fn(),
}));

vi.mock('../../lib/shared/favorites.ts', () => ({
  toggleFavorite: vi.fn(),
}));

vi.mock('../../lib/background/rpc.ts', () => ({
  rawJsonRpc: vi.fn(),
}));

// ── Chrome API stubs ──
let connectListener: (port: chrome.runtime.Port) => void;

beforeEach(() => {
  vi.clearAllMocks();

  chrome.runtime.onConnect = {
    addListener: vi.fn((fn) => { connectListener = fn; }),
    removeListener: vi.fn(),
  } as unknown as typeof chrome.runtime.onConnect;

  chrome.runtime.onMessage = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  } as unknown as typeof chrome.runtime.onMessage;
});

async function setupBackground() {
  await import('../../entrypoints/background.ts');
  backgroundFn();
}

function simulatePort() {
  const listeners: Array<(msg: unknown) => void> = [];
  const port = {
    name: 'csm-popup',
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => void) => { listeners.push(fn); }),
    },
    onDisconnect: {
      addListener: vi.fn(),
    },
    _emit(msg: unknown) { listeners.forEach((fn) => fn(msg)); },
  } as unknown as chrome.runtime.Port & { _emit: (msg: unknown) => void };

  connectListener(port);
  return port;
}

describe('switch-module', () => {
  it('preserves connected address when switching modules', async () => {
    const state = makeState({
      moduleType: 'csm',
      selectedAddress: ADDR_A,
      isConnected: true,
    });
    const siteState = { chainId: state.chainId, moduleType: state.moduleType, selectedAddress: state.selectedAddress, isConnected: state.isConnected };
    getSiteState.mockResolvedValue(siteState);
    setSiteState.mockImplementation(async (_origin: string, update: Record<string, unknown>) => ({ ...siteState, ...update }));
    getGlobalSettings.mockResolvedValue({ customRpcUrls: {}, favorites: [], manualAddresses: [], addressLabels: {}, requireApproval: false });
    getComposedState.mockImplementation(async () => ({ ...siteState, ...await getGlobalSettings() }));

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-module', origin: TEST_ORIGIN, moduleType: 'cm' });

    await vi.waitFor(() => {
      expect(setSiteState).toHaveBeenCalledWith(TEST_ORIGIN, { moduleType: 'cm' });
    });

    // Must NOT reset address or connection
    expect(setSiteState).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ selectedAddress: null }),
    );
    expect(setSiteState).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ isConnected: false }),
    );
  });

  it('does not emit accountsChanged on module switch', async () => {
    const state = makeState({
      moduleType: 'csm',
      selectedAddress: ADDR_A,
      isConnected: true,
    });
    const siteState = { chainId: state.chainId, moduleType: state.moduleType, selectedAddress: state.selectedAddress, isConnected: state.isConnected };
    getSiteState.mockResolvedValue(siteState);
    setSiteState.mockImplementation(async (_origin: string, update: Record<string, unknown>) => ({ ...siteState, ...update }));
    getGlobalSettings.mockResolvedValue({ customRpcUrls: {}, favorites: [], manualAddresses: [], addressLabels: {}, requireApproval: false });
    getComposedState.mockImplementation(async () => ({ ...siteState, ...await getGlobalSettings() }));

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-module', origin: TEST_ORIGIN, moduleType: 'cm' });

    await vi.waitFor(() => {
      expect(setSiteState).toHaveBeenCalled();
    });

    expect(notifyAccountsChanged).not.toHaveBeenCalled();
  });

  it('broadcasts updated state to popups', async () => {
    const state = makeState({
      moduleType: 'csm',
      selectedAddress: ADDR_A,
      isConnected: true,
    });
    const updatedState = { ...state, moduleType: 'cm' as const };
    const siteState = { chainId: state.chainId, moduleType: state.moduleType, selectedAddress: state.selectedAddress, isConnected: state.isConnected };
    getSiteState.mockResolvedValue(siteState);
    setSiteState.mockResolvedValue({ ...siteState, moduleType: 'cm' });
    getGlobalSettings.mockResolvedValue({ customRpcUrls: {}, favorites: [], manualAddresses: [], addressLabels: {}, requireApproval: false });
    getComposedState.mockResolvedValue(updatedState);

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-module', origin: TEST_ORIGIN, moduleType: 'cm' });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'state-update',
        state: updatedState,
      });
    });
  });
});
