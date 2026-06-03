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
  COMMON_ADDRESSES: {
    1: { smDiscovery: '0x4444444444444444444444444444444444444444' },
    560048: { smDiscovery: '0x4444444444444444444444444444444444444444' },
  },
  MODULE_NAME: { CSM: 'CSM', CM: 'CM' },
  MODULE_CONFIG: {
    CSM: {
      1: { contractAddresses: {}, moduleId: 1n },
      560048: { contractAddresses: {}, moduleId: 1n },
    },
    CM: {
      1: { contractAddresses: {}, moduleId: 2n },
      560048: { contractAddresses: {}, moduleId: 2n },
    },
  },
  OPERATOR_TYPE: { CC: 'CC' },
  getOperatorTypeByCurveId: (moduleName: 'CSM' | 'CM', curveId: bigint) => {
    const table: Record<string, bigint> = {
      CSM_DEF: 0n,
      CSM_LEA: 1n,
      CSM_ICS: 2n,
      CSM_IDVTC: 4n,
      CM_PO: 0n,
      CM_PTO: 1n,
      CM_PGO: 2n,
      CM_DO: 3n,
      CM_EEO: 4n,
      CM_IODC: 5n,
      CM_IODCP: 6n,
    };
    return Object.entries(table).find(
      ([key, id]) => id === curveId && key.startsWith(`${moduleName}_`),
    )?.[0];
  },
}));

vi.mock('@lidofinance/lido-csm-sdk/abi', () => ({
  SMDiscoveryAbi: [{ name: 'SMDiscoveryAbi' }],
  CuratedModuleAbi: [{ name: 'CuratedModuleAbi' }],
  MetaRegistryAbi: [{ name: 'MetaRegistryAbi' }],
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
      operatorType: 'CSM_DEF',
    });
  });

  it('scopes operatorType resolution to moduleType — CM curveId=1n is CM_PTO, not CSM_LEA', async () => {
    mockReadContract.mockResolvedValue([rawOperator({ curveId: 1n })]);

    const csm = await fetchOperators(ctx({ moduleType: 'csm' }));
    expect(csm.operators[0].operatorType).toBe('CSM_LEA');

    const cm = await fetchOperators(ctx({ moduleType: 'cm' }));
    expect(cm.operators[0].operatorType).toBe('CM_PTO');
  });

  it('curveId=4n disambiguates: CSM → CSM_IDVTC, CM → CM_EEO', async () => {
    mockReadContract.mockResolvedValue([rawOperator({ curveId: 4n })]);

    const csm = await fetchOperators(ctx({ moduleType: 'csm' }));
    expect(csm.operators[0].operatorType).toBe('CSM_IDVTC');

    const cm = await fetchOperators(ctx({ moduleType: 'cm' }));
    expect(cm.operators[0].operatorType).toBe('CM_EEO');
  });

  it('falls back to CC when curveId is unknown for the module', async () => {
    mockReadContract.mockResolvedValue([rawOperator({ curveId: 99n })]);

    const entry = await fetchOperators(ctx({ moduleType: 'cm' }));
    expect(entry.operators[0].operatorType).toBe('CC');
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

// ── fetchOperators CM group enrichment ──
// CM operators get groupId/groupName from on-chain MetaRegistry. The cache
// fetch chains: SMDiscovery.moduleCache → CuratedModule.META_REGISTRY →
// MetaRegistry.getNodeOperatorGroupId (per op) → getOperatorGroup (per unique
// non-zero group). Failure of any step leaves operators ungrouped.

describe('fetchOperators (CM group enrichment)', () => {
  const rawOperator = (overrides: Record<string, unknown> = {}) => ({
    id: 0n,
    managerAddress: ADDR_A,
    rewardAddress: ADDR_B,
    proposedManagerAddress: zeroAddress,
    proposedRewardAddress: zeroAddress,
    extendedManagerPermissions: true,
    curveId: 0n,
    ...overrides,
  });

  /**
   * Route readContract calls by ABI/function so a single mock can simulate
   * the full SMDiscovery → CuratedModule → MetaRegistry chain.
   */
  function setupCmChain({
    moduleAddress,
    metaRegistry,
    groupIdByOpId,
    groupNameById,
    operators,
  }: {
    moduleAddress: string;
    metaRegistry: string;
    groupIdByOpId: Record<string, bigint>;
    groupNameById: Record<string, string>;
    operators: ReturnType<typeof rawOperator>[];
  }) {
    mockReadContract.mockImplementation((args: { functionName: string; args?: unknown[] }) => {
      switch (args.functionName) {
        case 'getAllNodeOperators': {
          // Single-batch return (length < BATCH_SIZE ends pagination)
          return Promise.resolve(operators);
        }
        case 'moduleCache':
          return Promise.resolve([moduleAddress]);
        case 'META_REGISTRY':
          return Promise.resolve(metaRegistry);
        case 'getNodeOperatorGroupId': {
          const opId = String(args.args![0]);
          return Promise.resolve(groupIdByOpId[opId] ?? 0n);
        }
        case 'getOperatorGroup': {
          const gid = String(args.args![0]);
          return Promise.resolve({
            name: groupNameById[gid] ?? '',
            subNodeOperators: [],
            externalOperators: [],
          });
        }
        default:
          return Promise.reject(new Error(`unmocked: ${args.functionName}`));
      }
    });
  }

  it('decorates CM operators with groupId + groupName from MetaRegistry', async () => {
    setupCmChain({
      moduleAddress: '0x5555555555555555555555555555555555555555',
      metaRegistry: '0x7777777777777777777777777777777777777777',
      groupIdByOpId: { '0': 3n, '1': 3n, '2': 7n, '3': 0n },
      groupNameById: { '3': 'Kiln Cluster', '7': '' },
      operators: [
        rawOperator({ id: 0n }),
        rawOperator({ id: 1n }),
        rawOperator({ id: 2n }),
        rawOperator({ id: 3n }),
      ],
    });

    const entry = await fetchOperators(ctx({ chainId: 1, moduleType: 'cm' }));

    expect(entry.operators[0]).toMatchObject({ id: '0', groupId: '3', groupName: 'Kiln Cluster' });
    expect(entry.operators[1]).toMatchObject({ id: '1', groupId: '3', groupName: 'Kiln Cluster' });
    expect(entry.operators[2]).toMatchObject({ id: '2', groupId: '7' });
    expect(entry.operators[2].groupName).toBeUndefined();
    expect(entry.operators[3].groupId).toBeUndefined();
    expect(entry.operators[3].groupName).toBeUndefined();
  });

  it('does not call MetaRegistry chain for CSM', async () => {
    mockReadContract.mockImplementation((args: { functionName: string }) => {
      if (args.functionName === 'getAllNodeOperators') return Promise.resolve([rawOperator()]);
      if (args.functionName === 'META_REGISTRY' || args.functionName === 'getNodeOperatorGroupId') {
        throw new Error('CSM should not invoke MetaRegistry chain');
      }
      return Promise.resolve([]);
    });

    const entry = await fetchOperators(ctx({ chainId: 1, moduleType: 'csm' }));
    expect(entry.operators[0].groupId).toBeUndefined();
  });

  it('leaves operators ungrouped if MetaRegistry resolution fails', async () => {
    mockReadContract.mockImplementation((args: { functionName: string }) => {
      switch (args.functionName) {
        case 'getAllNodeOperators':
          return Promise.resolve([rawOperator({ id: 9n })]);
        case 'moduleCache':
          return Promise.resolve([zeroAddress]); // module unavailable
        default:
          return Promise.reject(new Error(`unexpected: ${args.functionName}`));
      }
    });

    const entry = await fetchOperators(ctx({ chainId: 1, moduleType: 'cm' }));
    expect(entry.operators[0].groupId).toBeUndefined();
  });

  it('treats getOperatorGroup failure as missing name (operator still gets groupId)', async () => {
    mockReadContract.mockImplementation((args: { functionName: string; args?: unknown[] }) => {
      switch (args.functionName) {
        case 'getAllNodeOperators':
          return Promise.resolve([rawOperator({ id: 0n })]);
        case 'moduleCache':
          return Promise.resolve(['0x5555555555555555555555555555555555555555']);
        case 'META_REGISTRY':
          return Promise.resolve('0x7777777777777777777777777777777777777777');
        case 'getNodeOperatorGroupId':
          return Promise.resolve(11n);
        case 'getOperatorGroup':
          return Promise.reject(new Error('group fetch broke'));
        default:
          return Promise.reject(new Error(`unmocked: ${args.functionName}`));
      }
    });

    const entry = await fetchOperators(ctx({ chainId: 1, moduleType: 'cm' }));
    expect(entry.operators[0].groupId).toBe('11');
    expect(entry.operators[0].groupName).toBeUndefined();
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
