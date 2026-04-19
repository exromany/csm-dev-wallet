import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADDR_A, ADDR_B, makeState } from '../fixtures.js';

// ── Mock state module ──

const {
  mockGetComposedState,
  mockSetSiteState,
  mockNotifyAccountsChanged,
  mockNotifyChainChanged,
} = vi.hoisted(() => ({
  mockGetComposedState: vi.fn(),
  mockSetSiteState: vi.fn(),
  mockNotifyAccountsChanged: vi.fn(),
  mockNotifyChainChanged: vi.fn(),
}));

vi.mock('../../lib/background/state.js', () => ({
  getComposedState: mockGetComposedState,
  setSiteState: mockSetSiteState,
  notifyAccountsChanged: mockNotifyAccountsChanged,
  notifyChainChanged: mockNotifyChainChanged,
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
  mockGetComposedState.mockResolvedValue(makeState());
  mockSetSiteState.mockResolvedValue(undefined);
  mockNotifyAccountsChanged.mockResolvedValue(undefined);
  mockNotifyChainChanged.mockResolvedValue(undefined);
  // reset signing mode to default
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
