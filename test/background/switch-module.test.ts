import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeState, ADDR_A } from '../fixtures.js';

// ── Capture the callback passed to defineBackground ──
let backgroundFn: () => void;
vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (fn: () => void) => { backgroundFn = fn; },
}));

// ── Module mocks ──
const getState = vi.fn();
const setState = vi.fn();
const notifyChainChanged = vi.fn().mockResolvedValue(undefined);
const notifyAccountsChanged = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/background/state.ts', () => ({
  getState,
  setState,
  notifyAccountsChanged,
  notifyChainChanged,
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
    getState.mockResolvedValue(state);
    setState.mockImplementation(async (update: Partial<typeof state>) => ({ ...state, ...update }));

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-module', moduleType: 'cm' });

    await vi.waitFor(() => {
      expect(setState).toHaveBeenCalledWith({ moduleType: 'cm' });
    });

    // Must NOT reset address or connection
    expect(setState).not.toHaveBeenCalledWith(
      expect.objectContaining({ selectedAddress: null }),
    );
    expect(setState).not.toHaveBeenCalledWith(
      expect.objectContaining({ isConnected: false }),
    );
  });

  it('does not emit accountsChanged on module switch', async () => {
    const state = makeState({
      moduleType: 'csm',
      selectedAddress: ADDR_A,
      isConnected: true,
    });
    getState.mockResolvedValue(state);
    setState.mockImplementation(async (update: Partial<typeof state>) => ({ ...state, ...update }));

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-module', moduleType: 'cm' });

    await vi.waitFor(() => {
      expect(setState).toHaveBeenCalled();
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
    getState.mockResolvedValue(state);
    setState.mockResolvedValue(updatedState);

    await setupBackground();
    const port = simulatePort();

    port._emit({ type: 'switch-module', moduleType: 'cm' });

    await vi.waitFor(() => {
      expect(port.postMessage).toHaveBeenCalledWith({
        type: 'state-update',
        state: updatedState,
      });
    });
  });
});
