import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress, keccak256, toBytes } from 'viem';
import { ADDR_A, ADDR_B } from '../fixtures.js';

const { mockMulticall, mockGetCode, CSM_ADDR, CM_ADDR } = vi.hoisted(() => ({
  mockMulticall: vi.fn(),
  mockGetCode: vi.fn(),
  CSM_ADDR: '0x1000000000000000000000000000000000000001',
  CM_ADDR: '0x2000000000000000000000000000000000000001',
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ multicall: mockMulticall, getCode: mockGetCode })),
    http: vi.fn(),
  };
});

vi.mock('@lidofinance/lido-csm-sdk/common', () => ({
  MODULE_NAME: { CSM: 'CSM', CM: 'CM', CSM_02: 'CSM_02' },
  MODULE_CONFIG: {
    CSM: { 1: { contractAddresses: { csModule: CSM_ADDR }, moduleId: 1n } },
    CM: { 1: { contractAddresses: { curatedModule: CM_ADDR }, moduleId: 2n } },
    CSM_02: {},
  },
  MODULE_CONTRACT: { CSM: 'csModule', CM: 'curatedModule', CSM_02: 'csModule' },
}));

vi.mock('@lidofinance/lido-csm-sdk/abi', () => ({ BaseModuleAbi: [{ name: 'BaseModuleAbi' }] }));

import { rolesFor, rolesStorageKey, fetchRoles, getCachedRoles } from '../../lib/background/role-cache.js';
import { clearClientCache } from '../../lib/background/client.js';
import type { CacheContext } from '../../lib/shared/types.js';

const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';
const TOPUP = 'ENABLE_TOP_UP_ALLOCATION_ROLE';
const CTX: CacheContext = { chainId: 1, moduleType: 'cm', rpcUrl: 'https://rpc.example' };

let store: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  clearClientCache();
  store = {};
  mockGetCode.mockResolvedValue(undefined);
  vi.mocked(chrome.storage.local.get).mockImplementation((async (key: string) => ({ [key]: store[key] })) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation((async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  }) as never);
});

describe('rolesFor', () => {
  it('lists the roles each module contract holds', () => {
    expect(rolesFor('csm')).toEqual([PENALTY]);
    expect(rolesFor('csm02')).toEqual([PENALTY]);
    expect(rolesFor('cm')).toEqual([PENALTY, TOPUP]);
  });
});

describe('fetchRoles', () => {
  it('reads every role in one multicall and flags contract holders, checking each address once', async () => {
    mockMulticall.mockResolvedValue([
      { status: 'success', result: [ADDR_A, ADDR_B] },
      { status: 'success', result: [ADDR_B] },
    ]);
    mockGetCode.mockImplementation(async ({ address }: { address: string }) =>
      address === getAddress(ADDR_B) ? '0x6080' : undefined);

    const entry = await fetchRoles(CTX);

    expect(mockMulticall).toHaveBeenCalledTimes(1);
    expect(mockMulticall).toHaveBeenCalledWith({
      allowFailure: true,
      contracts: [PENALTY, TOPUP].map((role) => ({
        address: CM_ADDR, abi: [{ name: 'BaseModuleAbi' }], functionName: 'getRoleMembers', args: [keccak256(toBytes(role))],
      })),
    });
    expect(mockGetCode).toHaveBeenCalledTimes(2);
    const a = { address: getAddress(ADDR_A), isContract: false };
    const b = { address: getAddress(ADDR_B), isContract: true };
    expect(entry.roles).toEqual([
      { role: PENALTY, holders: [a, b] },
      { role: TOPUP, holders: [b] },
    ]);
    expect(await getCachedRoles(CTX)).toEqual(entry);
    expect(rolesStorageKey(CTX)).toBe('roles_cm_1');
  });

  it('checksums holders', async () => {
    mockMulticall.mockResolvedValue([
      { status: 'success', result: [ADDR_A.toLowerCase()] },
      { status: 'success', result: [] },
    ]);
    const entry = await fetchRoles(CTX);
    expect(entry.roles[0]!.holders[0]!.address).toBe(getAddress(ADDR_A));
  });

  it('isolates a failing role from the rest', async () => {
    mockMulticall.mockResolvedValue([
      { status: 'success', result: [ADDR_A] },
      { status: 'failure', error: new Error('boom') },
    ]);
    const entry = await fetchRoles(CTX);
    expect(entry.roles).toEqual([
      { role: PENALTY, holders: [{ address: getAddress(ADDR_A), isContract: false }] },
      { role: TOPUP, holders: [], error: 'boom' },
    ]);
  });

  it('marks every role errored when the multicall throws, and still stores the entry', async () => {
    mockMulticall.mockRejectedValue(new Error('rpc down'));
    const entry = await fetchRoles(CTX);
    expect(entry.roles).toEqual([
      { role: PENALTY, holders: [], error: 'rpc down' },
      { role: TOPUP, holders: [], error: 'rpc down' },
    ]);
    expect(await getCachedRoles(CTX)).toEqual(entry);
  });

  it('returns no roles and makes no RPC call for a module not configured on the chain', async () => {
    const entry = await fetchRoles({ ...CTX, moduleType: 'csm02' });
    expect(entry.roles).toEqual([]);
    expect(mockMulticall).not.toHaveBeenCalled();
  });

  it('on Anvil reads the forked chain contracts but stores under the Anvil chain id', async () => {
    mockMulticall.mockResolvedValue([{ status: 'success', result: [] }]);
    const ctx: CacheContext = { chainId: 31337, forkedFrom: 1, moduleType: 'csm', rpcUrl: 'http://127.0.0.1:8545' };
    await fetchRoles(ctx);
    expect(mockMulticall.mock.calls[0]![0].contracts[0].address).toBe(CSM_ADDR);
    expect(store['roles_csm_31337']).toBeDefined();
  });
});

describe('getCachedRoles', () => {
  it('returns null when nothing is stored', async () => {
    expect(await getCachedRoles(CTX)).toBeNull();
  });
});
