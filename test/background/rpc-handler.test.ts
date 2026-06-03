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
});
