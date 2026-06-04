import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSiteState, makeGlobalSettings } from '../fixtures.js';

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

describe('set-active-tab', () => {
  beforeEach(() => {
    const site = makeSiteState();
    getSiteState.mockResolvedValue(site);
    setSiteState.mockImplementation(async (_origin: string, update: Record<string, unknown>) => ({ ...site, ...update }));
    getGlobalSettings.mockResolvedValue(makeGlobalSettings());
    getComposedState.mockImplementation(async () => ({ ...site, ...makeGlobalSettings() }));
  });

  it('persists the chosen tab to per-site state', async () => {
    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'set-active-tab', origin: TEST_ORIGIN, tab: 'anvil' });

    await vi.waitFor(() => {
      expect(setSiteState).toHaveBeenCalledWith(TEST_ORIGIN, { activeTab: 'anvil' });
    });
  });

  it('broadcasts the updated state to popups', async () => {
    const composed = { ...makeSiteState({ activeTab: 'manual' }), ...makeGlobalSettings() };
    getComposedState.mockResolvedValue(composed);

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'set-active-tab', origin: TEST_ORIGIN, tab: 'manual' });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({ type: 'state-update', state: composed });
    });
  });
});
