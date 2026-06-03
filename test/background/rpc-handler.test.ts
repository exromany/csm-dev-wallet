import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSiteState, makeGlobalSettings, ADDR_A } from '../fixtures.js';

// ── Mock test-rpc: real NOT_HANDLED symbol, stubbed handler ──
const { mockHandleTestRpc, NOT_HANDLED } = vi.hoisted(() => ({
  mockHandleTestRpc: vi.fn(),
  NOT_HANDLED: Symbol('NOT_HANDLED'),
}));
vi.mock('../../lib/background/test-rpc.js', () => ({
  handleTestRpc: mockHandleTestRpc,
  NOT_HANDLED,
}));

// ── Mock state ──
const {
  mockGetSiteState,
  mockSetSiteState,
  mockGetGlobalSettings,
  mockNotifyChainChanged,
} = vi.hoisted(() => ({
  mockGetSiteState: vi.fn(),
  mockSetSiteState: vi.fn(),
  mockGetGlobalSettings: vi.fn(),
  mockNotifyChainChanged: vi.fn(),
}));
vi.mock('../../lib/background/state.js', () => ({
  getSiteState: mockGetSiteState,
  setSiteState: mockSetSiteState,
  getGlobalSettings: mockGetGlobalSettings,
  notifyChainChanged: mockNotifyChainChanged,
}));

// ── Mock anvil ──
const { mockWithImpersonation, mockGetForkedFrom } = vi.hoisted(() => ({
  mockWithImpersonation: vi.fn(),
  mockGetForkedFrom: vi.fn(),
}));
vi.mock('../../lib/background/anvil.js', () => ({
  withImpersonation: mockWithImpersonation,
  getForkedFrom: mockGetForkedFrom,
}));

// ── Mock rpc ──
const { mockRawJsonRpc } = vi.hoisted(() => ({ mockRawJsonRpc: vi.fn() }));
vi.mock('../../lib/background/rpc.js', () => ({ rawJsonRpc: mockRawJsonRpc }));

// ── Imports under test ──
import { handleRpcRequest } from '../../lib/background/rpc-handler.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';

const ORIGIN = 'https://stake.lido.fi';

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleTestRpc.mockResolvedValue(NOT_HANDLED);
  mockGetSiteState.mockResolvedValue(makeSiteState());
  mockGetGlobalSettings.mockResolvedValue(makeGlobalSettings());
  mockGetForkedFrom.mockResolvedValue(null);
  mockSetSiteState.mockResolvedValue(undefined);
  mockNotifyChainChanged.mockResolvedValue(undefined);
});

describe('handleRpcRequest — signing methods', () => {
  it('proxies personal_sign directly when source.type === "anvil"', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: ANVIL_CHAIN_ID,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'anvil', index: 0 },
        },
      }),
    );
    mockRawJsonRpc.mockResolvedValue({ result: '0xsignature' });

    const result = await handleRpcRequest('personal_sign', ['0xdead', ADDR_A], ORIGIN);

    expect(result).toEqual({ result: '0xsignature' });
    expect(mockWithImpersonation).not.toHaveBeenCalled();
    // Only the personal_sign call — no anvil_impersonateAccount round-trip.
    expect(mockRawJsonRpc).toHaveBeenCalledTimes(1);
    expect(mockRawJsonRpc).toHaveBeenCalledWith(
      expect.any(String),
      'personal_sign',
      ['0xdead', ADDR_A],
    );
  });

  it('returns watch-only error when chainId is not Anvil', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: 1,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'operator', operatorId: '42', role: 'manager' },
        },
      }),
    );

    const result = await handleRpcRequest('personal_sign', ['0xdead', ADDR_A], ORIGIN);

    expect(result.error?.code).toBe(4200);
    expect(result.error?.message).toMatch(/Watch-only/);
    expect(mockRawJsonRpc).not.toHaveBeenCalled();
    expect(mockWithImpersonation).not.toHaveBeenCalled();
  });

  it('returns a clear error for personal_sign when source is not "anvil"', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: ANVIL_CHAIN_ID,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'operator', operatorId: '42', role: 'manager' },
        },
      }),
    );

    const result = await handleRpcRequest('personal_sign', ['0xdead', ADDR_A], ORIGIN);

    expect(result.error?.code).toBe(4200);
    expect(result.error?.message).toMatch(/Anvil pre-funded account/);
    expect(mockWithImpersonation).not.toHaveBeenCalled();
    expect(mockRawJsonRpc).not.toHaveBeenCalled();
  });

  it('routes eth_sendTransaction through withImpersonation for operator source', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: ANVIL_CHAIN_ID,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'operator', operatorId: '42', role: 'manager' },
        },
      }),
    );
    // withImpersonation receives a fn() to execute under impersonation; we
    // run that fn to verify the inner proxy call happens.
    mockWithImpersonation.mockImplementation(async (_rpc, _addr, fn) => fn());
    mockRawJsonRpc.mockResolvedValue({ result: '0xtxhash' });

    const result = await handleRpcRequest(
      'eth_sendTransaction',
      [{ from: ADDR_A, to: ADDR_A, value: '0x0' }],
      ORIGIN,
    );

    expect(result).toEqual({ result: '0xtxhash' });
    expect(mockWithImpersonation).toHaveBeenCalledTimes(1);
    expect(mockWithImpersonation).toHaveBeenCalledWith(
      expect.any(String),
      ADDR_A,
      expect.any(Function),
    );
    expect(mockRawJsonRpc).toHaveBeenCalledWith(
      expect.any(String),
      'eth_sendTransaction',
      [{ from: ADDR_A, to: ADDR_A, value: '0x0' }],
    );
  });
});
