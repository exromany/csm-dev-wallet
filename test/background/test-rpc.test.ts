import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADDR_A, ADDR_B, ADDR_C, makeOperator, makeState, makeSiteState, makeGlobalSettings } from '../fixtures.js';

// ── Mock state module ──

const {
  mockGetComposedState,
  mockGetSiteState,
  mockSetSiteState,
  mockNotifyAccountsChanged,
  mockNotifyChainChanged,
  mockGetGlobalSettings,
  mockSetGlobalSettings,
} = vi.hoisted(() => ({
  mockGetComposedState: vi.fn(),
  mockGetSiteState: vi.fn(),
  mockSetSiteState: vi.fn(),
  mockNotifyAccountsChanged: vi.fn(),
  mockNotifyChainChanged: vi.fn(),
  mockGetGlobalSettings: vi.fn(),
  mockSetGlobalSettings: vi.fn(),
}));

vi.mock('../../lib/background/state.js', () => ({
  getComposedState: mockGetComposedState,
  getSiteState: mockGetSiteState,
  setSiteState: mockSetSiteState,
  notifyAccountsChanged: mockNotifyAccountsChanged,
  notifyChainChanged: mockNotifyChainChanged,
  getGlobalSettings: mockGetGlobalSettings,
  setGlobalSettings: mockSetGlobalSettings,
}));

// ── Mock operator-cache module ──

const { mockClearClientCache, mockFetchOperators } = vi.hoisted(() => ({
  mockClearClientCache: vi.fn(),
  mockFetchOperators: vi.fn(),
}));

vi.mock('../../lib/background/operator-cache.js', () => ({
  clearClientCache: mockClearClientCache,
  fetchOperators: mockFetchOperators,
}));

// ── Imports under test ──

import {
  handleTestRpc,
  NOT_HANDLED,
  getSigningMode,
  setSigningMode,
} from '../../lib/background/test-rpc.js';
import type { SigningMode } from '../../lib/background/test-rpc.js';

// ── Helpers ──

const ORIGIN = 'https://stake.lido.fi';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
  vi.mocked(chrome.storage.local.get).mockResolvedValue({});
  mockGetComposedState.mockResolvedValue(makeState());
  mockGetSiteState.mockResolvedValue(makeSiteState());
  mockSetSiteState.mockResolvedValue(undefined);
  mockGetGlobalSettings.mockResolvedValue(makeGlobalSettings());
  mockSetGlobalSettings.mockResolvedValue(undefined);
  mockNotifyAccountsChanged.mockResolvedValue(undefined);
  mockNotifyChainChanged.mockResolvedValue(undefined);
  setSigningMode('prompt');
});

// ── NOT_HANDLED for unknown methods ──

describe('NOT_HANDLED', () => {
  it('returns NOT_HANDLED for non-test methods', async () => {
    expect(await handleTestRpc(ORIGIN, 'eth_blockNumber')).toBe(NOT_HANDLED);
    expect(await handleTestRpc(ORIGIN, 'wallet_requestPermissions')).toBe(NOT_HANDLED);
    expect(await handleTestRpc(ORIGIN, 'unknown_method')).toBe(NOT_HANDLED);
  });

  it('NOT_HANDLED is a symbol', () => {
    expect(typeof NOT_HANDLED).toBe('symbol');
  });
});

// ── wallet_testGetState ──

describe('wallet_testGetState', () => {
  it('calls getComposedState with origin and returns result', async () => {
    const state = makeState({ chainId: 560048, isConnected: true });
    mockGetComposedState.mockResolvedValue(state);

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetState');

    expect(mockGetComposedState).toHaveBeenCalledWith(ORIGIN);
    expect(res).toEqual({ result: state });
  });
});

// ── wallet_testConnect ──

describe('wallet_testConnect', () => {
  it('connects with address — sets state and notifies', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testConnect', [{ address: ADDR_A }]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: { address: ADDR_A, source: { type: 'manual' } },
      isConnected: true,
    });
    expect(mockNotifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, [ADDR_A]);
    expect(res).toEqual({ result: null });
  });

  it('connects with address and explicit source', async () => {
    const source = { type: 'operator' as const, operatorId: '7', role: 'manager' as const };
    await handleTestRpc(ORIGIN, 'wallet_testConnect', [{ address: ADDR_A, source }]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: { address: ADDR_A, source },
      isConnected: true,
    });
  });

  it('connects without address — only sets isConnected', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testConnect', [{}]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, { isConnected: true });
    expect(mockNotifyAccountsChanged).not.toHaveBeenCalled();
    expect(res).toEqual({ result: null });
  });

  it('connects with no params — treats as no address', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testConnect');

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, { isConnected: true });
    expect(mockNotifyAccountsChanged).not.toHaveBeenCalled();
  });
});

// ── wallet_testDisconnect ──

describe('wallet_testDisconnect', () => {
  it('clears selected address, disconnects, notifies empty accounts', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testDisconnect');

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: null,
      isConnected: false,
    });
    expect(mockNotifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, []);
    expect(res).toEqual({ result: null });
  });
});

// ── wallet_testSetAccount ──

describe('wallet_testSetAccount', () => {
  it('sets address with default manual source and notifies', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetAccount', [{ address: ADDR_B }]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: { address: ADDR_B, source: { type: 'manual' } },
      isConnected: true,
    });
    expect(mockNotifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, [ADDR_B]);
    expect(res).toEqual({ result: null });
  });

  it('sets address with explicit operator source', async () => {
    const source = { type: 'operator' as const, operatorId: '42', role: 'rewards' as const };
    await handleTestRpc(ORIGIN, 'wallet_testSetAccount', [{ address: ADDR_A, source }]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: { address: ADDR_A, source },
      isConnected: true,
    });
    expect(mockNotifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, [ADDR_A]);
  });

  it('returns -32602 when address is missing', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetAccount', [{}]);
    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(mockSetSiteState).not.toHaveBeenCalled();
  });

  it('returns -32602 when called with no params', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetAccount');
    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(mockSetSiteState).not.toHaveBeenCalled();
  });
});

// ── wallet_testSetNetwork ──

describe('wallet_testSetNetwork', () => {
  it('sets chainId and notifies chain change', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetNetwork', [{ chainId: 560048 }]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, { chainId: 560048 });
    expect(mockNotifyChainChanged).toHaveBeenCalledWith(ORIGIN, 560048);
    expect(res).toEqual({ result: null });
  });

  it('works with mainnet chainId', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testSetNetwork', [{ chainId: 1 }]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, { chainId: 1 });
    expect(mockNotifyChainChanged).toHaveBeenCalledWith(ORIGIN, 1);
  });
});

// ── wallet_testSetSigningMode ──

describe('wallet_testSetSigningMode', () => {
  it('sets approve mode', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [{ mode: 'approve' }]);
    expect(res).toEqual({ result: null });
    expect(getSigningMode()).toBe('approve');
  });

  it('sets reject mode', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [{ mode: 'reject' }]);
    expect(getSigningMode()).toBe('reject');
  });

  it('sets error mode', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [{ mode: 'error' }]);
    expect(getSigningMode()).toBe('error');
  });

  it('sets prompt mode', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [{ mode: 'prompt' }]);
    expect(getSigningMode()).toBe('prompt');
  });

  it('rejects invalid mode with -32602 error', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [{ mode: 'invalid' }]);
    expect(res).toEqual({
      error: expect.objectContaining({ code: -32602 }),
    });
    // signing mode unchanged
    expect(getSigningMode()).toBe('prompt');
  });

  it('rejects empty mode', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [{ mode: '' }]);
    expect(res).toMatchObject({ error: { code: -32602 } });
  });
});

// ── getSigningMode / setSigningMode ──

describe('getSigningMode / setSigningMode', () => {
  it('defaults to prompt', () => {
    expect(getSigningMode()).toBe('prompt');
  });

  it('round-trips all valid modes', () => {
    const modes: SigningMode[] = ['approve', 'reject', 'error', 'prompt'];
    for (const mode of modes) {
      setSigningMode(mode);
      expect(getSigningMode()).toBe(mode);
    }
  });
});

// ── wallet_testSeedOperators ──

describe('wallet_testSeedOperators', () => {
  it('writes operators to chrome.storage.local with correct key', async () => {
    const operators = [{ id: '1', managerAddress: ADDR_A }];
    const res = await handleTestRpc(ORIGIN, 'wallet_testSeedOperators', [
      { operators, chainId: 1, moduleType: 'csm' },
    ]);

    expect(res).toEqual({ result: null });
    expect(vi.mocked(chrome.storage.local.set)).toHaveBeenCalledWith(
      expect.objectContaining({
        operators_csm_1: expect.objectContaining({
          operators,
          lastFetchedAt: expect.any(Number),
        }),
      }),
    );
  });

  it('uses correct key format: operators_{moduleType}_{chainId}', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testSeedOperators', [
      { operators: [], chainId: 560048, moduleType: 'cm' },
    ]);

    const setCall = vi.mocked(chrome.storage.local.set).mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(setCall)).toEqual(['operators_cm_560048']);
  });

  it('sets lastFetchedAt to a recent timestamp', async () => {
    const before = Date.now();
    await handleTestRpc(ORIGIN, 'wallet_testSeedOperators', [
      { operators: [], chainId: 1, moduleType: 'csm' },
    ]);
    const after = Date.now();

    const setCall = vi.mocked(chrome.storage.local.set).mock.calls[0]![0] as Record<
      string,
      { lastFetchedAt: number }
    >;
    const { lastFetchedAt } = setCall['operators_csm_1']!;
    expect(lastFetchedAt).toBeGreaterThanOrEqual(before);
    expect(lastFetchedAt).toBeLessThanOrEqual(after);
  });
});

// ── wallet_testGetOperators ──

describe('wallet_testGetOperators', () => {
  it('returns cached operators for explicit chainId/moduleType', async () => {
    const operators = [makeOperator({ id: '1' }), makeOperator({ id: '2' })];
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_csm_1: { operators, lastFetchedAt: Date.now() },
    });

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperators', [
      { chainId: 1, moduleType: 'csm' },
    ]);

    expect(chrome.storage.local.get).toHaveBeenCalledWith('operators_csm_1');
    expect(res).toEqual({ result: operators });
  });

  it('defaults to current site state when no params', async () => {
    mockGetSiteState.mockResolvedValue(makeSiteState({ chainId: 560048, moduleType: 'cm' }));
    const operators = [makeOperator({ id: '5' })];
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_cm_560048: { operators, lastFetchedAt: Date.now() },
    });

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperators', [{}]);

    expect(chrome.storage.local.get).toHaveBeenCalledWith('operators_cm_560048');
    expect(res).toEqual({ result: operators });
  });

  it('returns null when no cache exists', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({});

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperators', [
      { chainId: 1, moduleType: 'csm' },
    ]);

    expect(res).toEqual({ result: null });
  });
});

// ── wallet_testGetOperator ──

describe('wallet_testGetOperator', () => {
  it('returns operator by id', async () => {
    const op = makeOperator({ id: '42' });
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_csm_1: { operators: [makeOperator({ id: '1' }), op], lastFetchedAt: Date.now() },
    });

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperator', [
      { operatorId: '42', chainId: 1, moduleType: 'csm' },
    ]);

    expect(res).toEqual({ result: op });
  });

  it('defaults chainId/moduleType from site state', async () => {
    mockGetSiteState.mockResolvedValue(makeSiteState({ chainId: 560048, moduleType: 'cm' }));
    const op = makeOperator({ id: '7' });
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_cm_560048: { operators: [op], lastFetchedAt: Date.now() },
    });

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperator', [{ operatorId: '7' }]);

    expect(chrome.storage.local.get).toHaveBeenCalledWith('operators_cm_560048');
    expect(res).toEqual({ result: op });
  });

  it('returns -32602 when operatorId missing', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperator', [{}]);
    expect(res).toMatchObject({ error: { code: -32602 } });
  });

  it('returns -32601 when operator not found', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_csm_1: { operators: [makeOperator({ id: '1' })], lastFetchedAt: Date.now() },
    });

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperator', [
      { operatorId: '99', chainId: 1, moduleType: 'csm' },
    ]);

    expect(res).toMatchObject({ error: { code: -32601 } });
  });

  it('returns -32601 when no cache exists', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({});

    const res = await handleTestRpc(ORIGIN, 'wallet_testGetOperator', [
      { operatorId: '1', chainId: 1, moduleType: 'csm' },
    ]);

    expect(res).toMatchObject({ error: { code: -32601 } });
  });
});

// ── wallet_testSetOperatorAccount ──

describe('wallet_testSetOperatorAccount', () => {
  const op = makeOperator({
    id: '10',
    managerAddress: ADDR_A,
    rewardsAddress: ADDR_B,
    proposedManagerAddress: ADDR_C,
    proposedRewardsAddress: undefined,
  });

  beforeEach(() => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_csm_1: { operators: [op], lastFetchedAt: Date.now() },
    });
  });

  it('sets manager address', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', role: 'manager', chainId: 1, moduleType: 'csm' },
    ]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: {
        address: ADDR_A,
        source: { type: 'operator', operatorId: '10', role: 'manager' },
      },
      isConnected: true,
    });
    expect(mockNotifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, [ADDR_A]);
    expect(res).toEqual({ result: null });
  });

  it('sets rewards address', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', role: 'rewards', chainId: 1, moduleType: 'csm' },
    ]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: {
        address: ADDR_B,
        source: { type: 'operator', operatorId: '10', role: 'rewards' },
      },
      isConnected: true,
    });
    expect(res).toEqual({ result: null });
  });

  it('sets proposedManager address', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', role: 'proposedManager', chainId: 1, moduleType: 'csm' },
    ]);

    expect(mockSetSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: {
        address: ADDR_C,
        source: { type: 'operator', operatorId: '10', role: 'proposedManager' },
      },
      isConnected: true,
    });
    expect(res).toEqual({ result: null });
  });

  it('returns -32602 when role address is absent (proposedRewards not set)', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', role: 'proposedRewards', chainId: 1, moduleType: 'csm' },
    ]);

    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(mockSetSiteState).not.toHaveBeenCalled();
  });

  it('returns -32602 when operatorId missing', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { role: 'manager', chainId: 1, moduleType: 'csm' },
    ]);
    expect(res).toMatchObject({ error: { code: -32602 } });
  });

  it('returns -32602 when role missing', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', chainId: 1, moduleType: 'csm' },
    ]);
    expect(res).toMatchObject({ error: { code: -32602 } });
  });

  it('returns -32602 for invalid role', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', role: 'owner', chainId: 1, moduleType: 'csm' },
    ]);
    expect(res).toMatchObject({ error: { code: -32602 } });
  });

  it('returns -32601 when operator not found', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '999', role: 'manager', chainId: 1, moduleType: 'csm' },
    ]);
    expect(res).toMatchObject({ error: { code: -32601 } });
  });

  it('accepts explicit chainId and moduleType', async () => {
    mockGetSiteState.mockResolvedValue(makeSiteState({ chainId: 560048, moduleType: 'cm' }));
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      operators_csm_1: { operators: [op], lastFetchedAt: Date.now() },
    });

    const res = await handleTestRpc(ORIGIN, 'wallet_testSetOperatorAccount', [
      { operatorId: '10', role: 'manager', chainId: 1, moduleType: 'csm' },
    ]);

    expect(chrome.storage.local.get).toHaveBeenCalledWith('operators_csm_1');
    expect(res).toEqual({ result: null });
  });
});

// ── wallet_testSetRpcUrl ──

describe('wallet_testSetRpcUrl', () => {
  it('persists custom RPC URL via setGlobalSettings', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetRpcUrl', [
      { chainId: 1, rpcUrl: 'https://my-rpc.example.com' },
    ]);

    expect(mockSetGlobalSettings).toHaveBeenCalledWith({
      customRpcUrls: { 1: 'https://my-rpc.example.com' },
    });
    expect(res).toEqual({ result: null });
  });

  it('merges with existing custom RPC URLs', async () => {
    mockGetGlobalSettings.mockResolvedValue(
      makeGlobalSettings({ customRpcUrls: { 560048: 'https://existing-hoodi-rpc.com' } }),
    );

    const res = await handleTestRpc(ORIGIN, 'wallet_testSetRpcUrl', [
      { chainId: 1, rpcUrl: 'https://my-rpc.example.com' },
    ]);

    expect(mockSetGlobalSettings).toHaveBeenCalledWith({
      customRpcUrls: {
        560048: 'https://existing-hoodi-rpc.com',
        1: 'https://my-rpc.example.com',
      },
    });
    expect(res).toEqual({ result: null });
  });

  it('clears client cache', async () => {
    await handleTestRpc(ORIGIN, 'wallet_testSetRpcUrl', [
      { chainId: 1, rpcUrl: 'https://my-rpc.example.com' },
    ]);

    expect(mockClearClientCache).toHaveBeenCalledOnce();
  });

  it('returns -32602 when chainId missing', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetRpcUrl', [
      { rpcUrl: 'https://my-rpc.example.com' },
    ]);
    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(mockSetGlobalSettings).not.toHaveBeenCalled();
  });

  it('returns -32602 when rpcUrl missing', async () => {
    const res = await handleTestRpc(ORIGIN, 'wallet_testSetRpcUrl', [{ chainId: 1 }]);
    expect(res).toMatchObject({ error: { code: -32602 } });
    expect(mockSetGlobalSettings).not.toHaveBeenCalled();
  });
});
