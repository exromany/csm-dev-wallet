import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeOperator, ADDR_A } from '../fixtures.js';

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

const detectAnvilFork = vi.fn();
const getForkedFrom = vi.fn();
vi.mock('../../lib/background/anvil.ts', () => ({
  detectAnvilFork,
  getAnvilAccounts: vi.fn().mockResolvedValue([]),
  withImpersonation: vi.fn(),
  getForkedFrom,
  setForkedFrom: vi.fn().mockResolvedValue(undefined),
  clearForkedFrom: vi.fn().mockResolvedValue(undefined),
}));

const fetchOperators = vi.fn();
const getCachedOperators = vi.fn();
vi.mock('../../lib/background/operator-cache.ts', () => ({
  fetchOperators,
  getCachedOperators,
  isStale: vi.fn().mockReturnValue(false),
  isModuleAvailable: vi.fn().mockResolvedValue(true),
  getModuleAvailabilityCache: vi.fn().mockResolvedValue(null),
  setModuleAvailabilityCache: vi.fn().mockResolvedValue(undefined),
  clearAvailabilityCache: vi.fn(),
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

  getGlobalSettings.mockResolvedValue({ customRpcUrls: {}, favorites: [], manualAddresses: [], addressLabels: {}, requireApproval: false });
  getForkedFrom.mockResolvedValue(null);
  getCachedOperators.mockResolvedValue(null);

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

describe('request-operators bail paths', () => {
  it('broadcasts operators-loading:false for an unsupported chain instead of leaving the popup stuck', async () => {
    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'request-operators', origin: TEST_ORIGIN, chainId: 999999, moduleType: 'csm' });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'operators-loading',
        chainId: 999999,
        moduleType: 'csm',
        loading: false,
      });
    });
    expect(fetchOperators).not.toHaveBeenCalled();
  });

  it('broadcasts operators-loading:false for Anvil with no detectable fork', async () => {
    detectAnvilFork.mockResolvedValue(null);

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'request-operators', origin: TEST_ORIGIN, chainId: 31337, moduleType: 'csm' });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'operators-loading',
        chainId: 31337,
        moduleType: 'csm',
        loading: false,
      });
    });
    expect(fetchOperators).not.toHaveBeenCalled();
  });
});

describe('triggerRefresh in-flight dedupe', () => {
  it('runs only one fetch when two callers request the same module+chain concurrently', async () => {
    let resolveFetch!: (value: { operators: ReturnType<typeof makeOperator>[]; lastFetchedAt: number }) => void;
    fetchOperators.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'request-operators', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    port._emit({ type: 'request-operators', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });

    await vi.waitFor(() => {
      expect(fetchOperators).toHaveBeenCalled();
    });
    expect(fetchOperators).toHaveBeenCalledTimes(1);

    resolveFetch({ operators: [makeOperator({ id: '12', managerAddress: ADDR_A })], lastFetchedAt: 1000 });

    await vi.waitFor(() => {
      const updates = port.postMessage.mock.calls
        .map(([msg]) => msg as { type: string })
        .filter((msg) => msg.type === 'operators-update');
      expect(updates).toHaveLength(1);
    });

    const loadingFalse = port.postMessage.mock.calls
      .map(([msg]) => msg as { type: string; loading?: boolean })
      .filter((msg) => msg.type === 'operators-loading' && msg.loading === false);
    // Only the single deduped task settles loading — no premature clear from a second caller.
    expect(loadingFalse).toHaveLength(1);
  });
});
