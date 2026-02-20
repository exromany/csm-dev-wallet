import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zeroAddress } from 'viem';
import { ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';

// ── Mocks ──

const { mockReadContract } = vi.hoisted(() => ({ mockReadContract: vi.fn() }));
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: mockReadContract })),
    http: vi.fn(),
  };
});

vi.mock('@lidofinance/lido-csm-sdk/common', () => ({
  COMMON_CONTRACT_ADDRESSES: {
    1: { SMDiscovery: '0x4444444444444444444444444444444444444444' },
    560048: { SMDiscovery: '0x4444444444444444444444444444444444444444' },
  },
  CSM_MODULE_IDS: { 1: 1, 560048: 1 },
  CM_MODULE_IDS: { 1: 2, 560048: 2 },
  CSM_OPERATOR_TYPE_CURVE_ID: { DEF: 0n, LEA: 1n, ICS: 2n, CC: 3n },
  CM_OPERATOR_TYPE_CURVE_ID: { PTO: 0n, PO: 1n, CC: 3n },
}));

vi.mock('@lidofinance/lido-csm-sdk/abi', () => ({
  SMDiscoveryAbi: [{ name: 'stub' }],
}));

// ── Imports under test ──

import {
  storageKey,
  getCachedOperators,
  isStale,
  isModuleAvailable,
  fetchOperators,
  clearClientCache,
  getModuleAvailabilityCache,
  setModuleAvailabilityCache,
} from '../../lib/background/operator-cache.js';
import type { CacheContext, OperatorCacheEntry } from '../../lib/shared/types.js';

// ── Helpers ──

const ctx = (overrides: Partial<CacheContext> = {}): CacheContext => ({
  chainId: 1,
  moduleType: 'csm',
  rpcUrl: 'https://eth.drpc.org',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearClientCache();
  vi.mocked(chrome.storage.local.get).mockResolvedValue({});
  vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
});

// ── storageKey ──

describe('storageKey', () => {
  it('mainnet CSM → operators_csm_1', () => {
    expect(storageKey(ctx())).toBe('operators_csm_1');
  });

  it('anvil CM → operators_cm_31337', () => {
    expect(storageKey(ctx({ chainId: 31337, moduleType: 'cm', forkedFrom: 560048 }))).toBe(
      'operators_cm_31337',
    );
  });
});

// ── getCachedOperators ──

describe('getCachedOperators', () => {
  it('returns null when storage empty', async () => {
    expect(await getCachedOperators(ctx())).toBeNull();
  });

  it('returns cached entry when present', async () => {
    const entry: OperatorCacheEntry = { operators: [], lastFetchedAt: 1000 };
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ operators_csm_1: entry });

    expect(await getCachedOperators(ctx())).toEqual(entry);
  });
});

// ── isStale ──

describe('isStale', () => {
  it('fresh entry (10 min ago) → false', () => {
    expect(isStale({ operators: [], lastFetchedAt: Date.now() - 10 * 60_000 })).toBe(false);
  });

  it('stale entry (31 min ago) → true', () => {
    expect(isStale({ operators: [], lastFetchedAt: Date.now() - 31 * 60_000 })).toBe(true);
  });

  it('exactly 30 min → false (uses >)', () => {
    expect(isStale({ operators: [], lastFetchedAt: Date.now() - 30 * 60_000 })).toBe(false);
  });
});

// ── isModuleAvailable ──
// Each test uses a unique moduleType:chainId combo to avoid in-memory cache collisions.

describe('isModuleAvailable', () => {
  it('returns true when RPC returns non-zero module address', async () => {
    mockReadContract.mockResolvedValue(['0x5555555555555555555555555555555555555555']);

    expect(await isModuleAvailable(ctx({ chainId: 101, moduleType: 'csm', forkedFrom: 1 }))).toBe(
      true,
    );
  });

  it('returns false when RPC returns zeroAddress', async () => {
    mockReadContract.mockResolvedValue([zeroAddress]);

    expect(
      await isModuleAvailable(ctx({ chainId: 102, moduleType: 'csm', forkedFrom: 1 })),
    ).toBe(false);
  });

  it('returns false on RPC error', async () => {
    mockReadContract.mockRejectedValue(new Error('rpc down'));

    expect(
      await isModuleAvailable(ctx({ chainId: 103, moduleType: 'csm', forkedFrom: 1 })),
    ).toBe(false);
  });

  it('uses ctx.chainId for cache key — Anvil caches under 31337', async () => {
    mockReadContract.mockResolvedValue(['0x5555555555555555555555555555555555555555']);

    const anvilCtx = ctx({ chainId: 31337, moduleType: 'cm', forkedFrom: 560048 });
    expect(await isModuleAvailable(anvilCtx)).toBe(true);

    // Verify persistent cache checked with chainId 31337, not forkedFrom
    expect(chrome.storage.local.get).toHaveBeenCalledWith('module_availability_31337');
  });

  it('persisted CM cache hit — skips RPC', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      module_availability_104: { csm: true, cm: true, checkedAt: Date.now() },
    });

    expect(
      await isModuleAvailable(ctx({ chainId: 104, moduleType: 'cm', forkedFrom: 1 })),
    ).toBe(true);
    expect(mockReadContract).not.toHaveBeenCalled();
  });

  it('memory cache TTL — returns cached result within 5 min without RPC', async () => {
    mockReadContract.mockResolvedValue(['0x5555555555555555555555555555555555555555']);

    const c = ctx({ chainId: 105, moduleType: 'csm', forkedFrom: 1 });
    await isModuleAvailable(c);
    expect(mockReadContract).toHaveBeenCalledTimes(1);

    // Second call reuses memory cache
    await isModuleAvailable(c);
    expect(mockReadContract).toHaveBeenCalledTimes(1);
  });
});

// ── fetchOperators ──

describe('fetchOperators', () => {
  const rawOperator = (overrides: Record<string, unknown> = {}) => ({
    id: 1n,
    managerAddress: ADDR_A,
    rewardAddress: ADDR_B,
    proposedManagerAddress: zeroAddress,
    proposedRewardAddress: zeroAddress,
    extendedManagerPermissions: true,
    curveId: 0n,
    ...overrides,
  });

  it('transforms SDK fields correctly', async () => {
    mockReadContract.mockResolvedValue([rawOperator()]);

    const entry = await fetchOperators(ctx());

    expect(entry.operators[0]).toMatchObject({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_B,
      proposedManagerAddress: undefined,
      proposedRewardsAddress: undefined,
      extendedManagerPermissions: true,
      curveId: '0',
      operatorType: 'DEF',
    });
  });

  it('owner = manager when extendedManagerPermissions true', async () => {
    mockReadContract.mockResolvedValue([rawOperator()]);

    const entry = await fetchOperators(ctx());
    expect(entry.operators[0].ownerAddress).toBe(ADDR_A);
  });

  it('owner = rewards when extendedManagerPermissions false', async () => {
    mockReadContract.mockResolvedValue([
      rawOperator({ extendedManagerPermissions: false }),
    ]);

    const entry = await fetchOperators(ctx());
    expect(entry.operators[0].ownerAddress).toBe(ADDR_B);
  });

  it('keeps non-zero proposed addresses', async () => {
    mockReadContract.mockResolvedValue([
      rawOperator({ proposedManagerAddress: ADDR_C, proposedRewardAddress: ADDR_C }),
    ]);

    const entry = await fetchOperators(ctx());
    expect(entry.operators[0].proposedManagerAddress).toBe(ADDR_C);
    expect(entry.operators[0].proposedRewardsAddress).toBe(ADDR_C);
  });

  it('stores result under storageKey(ctx)', async () => {
    mockReadContract.mockResolvedValue([rawOperator()]);

    await fetchOperators(ctx());

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        operators_csm_1: expect.objectContaining({ operators: expect.any(Array) }),
      }),
    );
  });

  it('anvil context stores under chainId 31337', async () => {
    mockReadContract.mockResolvedValue([rawOperator()]);

    await fetchOperators(ctx({ chainId: 31337, moduleType: 'csm', forkedFrom: 1 }));

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ operators_csm_31337: expect.any(Object) }),
    );
  });
});

// ── Availability cache helpers ──

describe('availability cache helpers', () => {
  it('setModuleAvailabilityCache writes with checkedAt', async () => {
    await setModuleAvailabilityCache(1, { csm: true, cm: false });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      module_availability_1: expect.objectContaining({
        csm: true,
        cm: false,
        checkedAt: expect.any(Number),
      }),
    });
  });

  it('getModuleAvailabilityCache reads back without checkedAt', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({
      module_availability_1: { csm: true, cm: false, checkedAt: Date.now() },
    });

    const result = await getModuleAvailabilityCache(1);
    expect(result).toEqual({ csm: true, cm: false });
  });

  it('returns null when key absent', async () => {
    expect(await getModuleAvailabilityCache(999)).toBeNull();
  });
});
