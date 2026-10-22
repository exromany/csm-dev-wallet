import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADDR_A } from '../fixtures.js';
import type { PopupCommand, PopupEvent } from '../../lib/shared/messages.js';

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

const fetchRoles = vi.fn();
const getCachedRoles = vi.fn();
vi.mock('../../lib/background/role-cache.ts', () => ({ fetchRoles, getCachedRoles }));

// ── Chrome API stubs ──
let connectListener: (port: chrome.runtime.Port) => void;

beforeEach(() => {
  vi.clearAllMocks();

  getGlobalSettings.mockResolvedValue({ customRpcUrls: {}, favorites: [], manualAddresses: [], addressLabels: {}, requireApproval: false });
  getForkedFrom.mockResolvedValue(null);
  getCachedOperators.mockResolvedValue(null);
  getCachedRoles.mockResolvedValue(null);
  fetchRoles.mockResolvedValue({ roles: [], lastFetchedAt: 1 });

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
  const listeners: Array<(msg: unknown) => unknown> = [];
  const port = {
    name: 'csm-popup',
    postMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn((fn: (msg: unknown) => unknown) => { listeners.push(fn); }),
    },
    onDisconnect: {
      addListener: vi.fn(),
    },
    _emit(msg: unknown) { return Promise.all(listeners.map((fn) => fn(msg))); },
  } as unknown as chrome.runtime.Port & { _emit: (msg: unknown) => Promise<unknown> };

  connectListener(port);
  return port;
}

async function send(command: PopupCommand): Promise<PopupEvent[]> {
  await setupBackground();
  const port = simulatePort();
  await port._emit(command);
  return port.postMessage.mock.calls.map(([msg]) => msg as PopupEvent);
}

const ROLE = {
  role: 'REPORT_GENERAL_DELAYED_PENALTY_ROLE' as const,
  holders: [{ address: ADDR_A, isContract: false }],
};

describe('request-roles', () => {
  it('broadcasts a fresh cache without refetching', async () => {
    getCachedRoles.mockResolvedValue({ roles: [ROLE], lastFetchedAt: Date.now() });
    const events = await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(events).toContainEqual({ type: 'roles-update', chainId: 1, moduleType: 'csm', roles: [ROLE], lastFetchedAt: expect.any(Number) });
    expect(fetchRoles).not.toHaveBeenCalled();
  });

  it('fetches on a cold cache, bracketed by roles-loading', async () => {
    fetchRoles.mockResolvedValue({ roles: [ROLE], lastFetchedAt: 5 });
    const events = await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    const types = events.filter((e) => e.type.startsWith('roles-')).map((e) => e.type === 'roles-loading' ? `loading:${e.loading}` : e.type);
    expect(types).toEqual(['loading:true', 'roles-update', 'loading:false']);
  });

  it('never broadcasts an error banner when the role fetch fails', async () => {
    fetchRoles.mockRejectedValue(new Error('rpc down'));
    const events = await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events).toContainEqual({ type: 'roles-loading', chainId: 1, moduleType: 'csm', loading: false });
  });

  it('refetches a fresh cache holding an errored role', async () => {
    const errored = { ...ROLE, holders: [], error: 'rpc down' };
    getCachedRoles.mockResolvedValue({ roles: [errored], lastFetchedAt: Date.now() });
    fetchRoles.mockResolvedValue({ roles: [ROLE], lastFetchedAt: Date.now() });
    await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(fetchRoles).toHaveBeenCalledTimes(1);
  });

  it('still replies on an unsupported network', async () => {
    const events = await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 999, moduleType: 'csm' });
    expect(events).toContainEqual({ type: 'roles-loading', chainId: 999, moduleType: 'csm', loading: false });
  });

  it('still replies on Anvil without a detectable fork', async () => {
    detectAnvilFork.mockResolvedValue(null);
    const events = await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 31337, moduleType: 'csm' });
    expect(events).toContainEqual({ type: 'roles-loading', chainId: 31337, moduleType: 'csm', loading: false });
  });

  it('uses the forked chain on Anvil', async () => {
    getForkedFrom.mockResolvedValue(1);
    await send({ type: 'request-roles', origin: TEST_ORIGIN, chainId: 31337, moduleType: 'csm' });
    expect(fetchRoles).toHaveBeenCalledWith(expect.objectContaining({ chainId: 31337, forkedFrom: 1 }));
  });
});

describe('refresh-roles', () => {
  it('refetches even when the cache is fresh', async () => {
    getCachedRoles.mockResolvedValue({ roles: [ROLE], lastFetchedAt: Date.now() });
    await send({ type: 'refresh-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(fetchRoles).toHaveBeenCalledTimes(1);
  });
});
