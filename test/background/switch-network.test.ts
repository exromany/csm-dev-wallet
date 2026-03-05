import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeState } from '../fixtures.js';

const TEST_ORIGIN = 'https://stake.lido.fi';

// ── Capture the callback passed to defineBackground ──
let backgroundFn: () => void;
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (fn: () => void) => { backgroundFn = fn; },
}));

// ── Module mocks (use .ts paths — vitest resolves before matching) ──
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

const detectAnvilFork = vi.fn();
const getAnvilAccounts = vi.fn();
vi.mock('../../lib/background/anvil.ts', () => ({
  detectAnvilFork,
  getAnvilAccounts,
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

  const state = makeState({ chainId: 1 });
  getSiteState.mockResolvedValue({ chainId: state.chainId, moduleType: state.moduleType, selectedAddress: state.selectedAddress, isConnected: state.isConnected });
  setSiteState.mockImplementation(async (_origin: string, update: Record<string, unknown>) => {
    const current = await getSiteState(_origin);
    return { ...current, ...update };
  });
  getGlobalSettings.mockResolvedValue({ customRpcUrls: state.customRpcUrls, favorites: state.favorites, manualAddresses: state.manualAddresses, addressLabels: state.addressLabels, requireApproval: state.requireApproval });
  getComposedState.mockResolvedValue(state);

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

describe('switch-network', () => {
  it('probes Anvil availability when switching to non-anvil network', async () => {
    detectAnvilFork.mockResolvedValue(560048); // Hoodi fork running
    getAnvilAccounts.mockResolvedValue([]);

    await setupBackground();
    const port = simulatePort();

    // Switch to Hoodi (non-anvil) — include origin
    port._emit({ type: 'switch-network', origin: TEST_ORIGIN, chainId: 560048 });

    // Let async handlers settle
    await vi.waitFor(() => {
      expect(detectAnvilFork).toHaveBeenCalled();
    });

    // Should broadcast anvil-status with forkedFrom (not null)
    const anvilMessages = port.postMessage.mock.calls
      .map(([msg]) => msg)
      .filter((msg: { type: string }) => msg.type === 'anvil-status');

    expect(anvilMessages).toContainEqual(
      expect.objectContaining({ type: 'anvil-status', forkedFrom: 560048 }),
    );
  });

  it('broadcasts anvil disabled when Anvil is down', async () => {
    detectAnvilFork.mockResolvedValue(null); // Anvil not running
    getAnvilAccounts.mockResolvedValue([]);

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-network', origin: TEST_ORIGIN, chainId: 560048 });

    await vi.waitFor(() => {
      expect(detectAnvilFork).toHaveBeenCalled();
    });

    const anvilMessages = port.postMessage.mock.calls
      .map(([msg]) => msg)
      .filter((msg: { type: string }) => msg.type === 'anvil-status');

    expect(anvilMessages).toContainEqual(
      expect.objectContaining({ type: 'anvil-status', forkedFrom: null }),
    );
  });
});
