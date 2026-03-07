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
const getComposedState = vi.fn();
const notifyAccountsChanged = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/background/state.ts', () => ({
  getSiteState,
  setSiteState,
  getGlobalSettings,
  setGlobalSettings: vi.fn(),
  getComposedState,
  notifyAccountsChanged,
  notifyChainChanged: vi.fn().mockResolvedValue(undefined),
  resetCaches: vi.fn(),
}));

vi.mock('../../lib/background/anvil.ts', () => ({
  detectAnvilFork: vi.fn().mockResolvedValue(null),
  getAnvilAccounts: vi.fn().mockResolvedValue([]),
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

const handleRpcRequest = vi.fn();
vi.mock('../../lib/background/rpc-handler.ts', () => ({
  handleRpcRequest,
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
let messageListener: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;
let windowRemoveListeners: Array<(windowId: number) => void>;

beforeEach(() => {
  vi.clearAllMocks();
  windowRemoveListeners = [];

  const state = makeState({ chainId: 1 });
  getSiteState.mockResolvedValue({
    chainId: state.chainId,
    moduleType: state.moduleType,
    selectedAddress: null,
    isConnected: false,
  });
  setSiteState.mockImplementation(async (_origin: string, update: Record<string, unknown>) => {
    const current = await getSiteState(_origin);
    return { ...current, ...update };
  });
  getGlobalSettings.mockResolvedValue({
    customRpcUrls: {},
    favorites: [],
    manualAddresses: [],
    addressLabels: {},
    requireApproval: false,
  });
  getComposedState.mockResolvedValue(state);

  chrome.runtime.onConnect = {
    addListener: vi.fn((fn) => { connectListener = fn; }),
    removeListener: vi.fn(),
  } as unknown as typeof chrome.runtime.onConnect;

  chrome.runtime.onMessage = {
    addListener: vi.fn((fn) => { messageListener = fn; }),
    removeListener: vi.fn(),
  } as unknown as typeof chrome.runtime.onMessage;

  chrome.runtime.getURL = vi.fn((path: string) => `chrome-extension://test-id/${path}`);

  chrome.windows = {
    create: vi.fn().mockResolvedValue({ id: 42 }),
    remove: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    onRemoved: {
      addListener: vi.fn((fn) => { windowRemoveListeners.push(fn); }),
      removeListener: vi.fn(),
    },
  } as unknown as typeof chrome.windows;
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

function sendRpcRequest(method: string, params?: unknown[]) {
  return new Promise<unknown>((resolve) => {
    messageListener(
      { type: 'rpc-request', origin: TEST_ORIGIN, method, params },
      { tab: { id: 1 } } as chrome.runtime.MessageSender,
      resolve,
    );
  });
}

describe('connection-prompt', () => {
  it('opens popup window when eth_requestAccounts and no address set', async () => {
    await setupBackground();

    // Start the request — it will wait for connection
    const responsePromise = sendRpcRequest('eth_requestAccounts');

    // Let the async handler run
    await vi.waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'popup',
          url: expect.stringContaining('popup.html?origin='),
        }),
      );
    });

    // Simulate address selection via popup port command
    const port = simulatePort();
    port._emit({
      type: 'select-address',
      origin: TEST_ORIGIN,
      address: ADDR_A,
      source: 'manager',
    });

    const response = await responsePromise;
    expect(response).toEqual(
      expect.objectContaining({ result: [ADDR_A] }),
    );
  });

  it('resolves with [] when connection window is closed', async () => {
    await setupBackground();

    const responsePromise = sendRpcRequest('eth_requestAccounts');

    await vi.waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalled();
    });

    // Simulate window close
    windowRemoveListeners.forEach((fn) => fn(42));

    const response = await responsePromise;
    expect(response).toEqual(
      expect.objectContaining({ result: [] }),
    );
  });

  it('falls through to rpc-handler when address already set', async () => {
    getSiteState.mockResolvedValue({
      chainId: 1,
      moduleType: 'csm',
      selectedAddress: { address: ADDR_A, source: 'manager' },
      isConnected: true,
    });
    handleRpcRequest.mockResolvedValue({ result: [ADDR_A] });

    await setupBackground();
    const response = await sendRpcRequest('eth_requestAccounts');

    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({ result: [ADDR_A] }),
    );
  });

  it('eth_accounts returns [] silently without opening window', async () => {
    handleRpcRequest.mockResolvedValue({ result: [] });

    await setupBackground();
    const response = await sendRpcRequest('eth_accounts');

    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({ result: [] }),
    );
  });

  it('reuses existing window for same origin', async () => {
    await setupBackground();

    // First request
    sendRpcRequest('eth_requestAccounts');
    await vi.waitFor(() => {
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    });

    // Second request from same origin — should focus, not create
    sendRpcRequest('eth_requestAccounts');
    await vi.waitFor(() => {
      expect(chrome.windows.update).toHaveBeenCalledWith(42, { focused: true });
    });
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);

    // Resolve both by closing window
    windowRemoveListeners.forEach((fn) => fn(42));
  });
});
