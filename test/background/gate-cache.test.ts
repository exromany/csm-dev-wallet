import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zeroHash, getAddress } from 'viem';
import { ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';

// Consts referenced by vi.mock factories below must live here too: real `import`s further
// down (of gate-cache.js) evaluate before this module's own top-level `const`s would.
const { mockMulticall, mockFetchTree, ICS, IDVTC, PTO, ROOT_1, ROOT_2, CID } = vi.hoisted(() => ({
  mockMulticall: vi.fn(),
  mockFetchTree: vi.fn(),
  ICS: '0x1000000000000000000000000000000000000001',
  IDVTC: '0x1000000000000000000000000000000000000002',
  PTO: '0x2000000000000000000000000000000000000001',
  ROOT_1: `0x${'11'.repeat(32)}`,
  ROOT_2: `0x${'22'.repeat(32)}`,
  CID: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return { ...actual, createPublicClient: vi.fn(() => ({ multicall: mockMulticall })), http: vi.fn() };
});

vi.mock('@lidofinance/lido-csm-sdk/common', () => ({
  MODULE_NAME: { CSM: 'CSM', CM: 'CM', CSM_02: 'CSM_02' },
  MODULE_CONFIG: {
    CSM: {
      1: { contractAddresses: { permissionlessGate: '0x9', icsGate: ICS, idvtcGate: IDVTC }, moduleId: 1n },
      560048: { contractAddresses: { icsGate: ICS }, moduleId: 1n },
    },
    CM: { 1: { contractAddresses: { curatedGatePTO: PTO }, moduleId: 2n } },
    CSM_02: { 560048: { contractAddresses: { permissionlessGate: '0x9' }, moduleId: 6n } },
  },
  CURATED_GATES: ['curatedGatePO', 'curatedGatePTO'],
  MERKLE_TREE_FALLBACKS: { CSM: { 1: { icsGate: 'https://github.example/ics.json' } } },
  DEFAULT_IPFS_GATEWAYS: ['https://{cid}.ipfs.dweb.link/', 'https://gateway.pinata.cloud/ipfs/'],
  isValidIpfsCid: (cid: string) => cid.length > 10,
  toCidV1Base32: (cid: string) => cid,
  fetchTree: mockFetchTree,
  getOperatorTypeByCurveId: (_c: number, ref: { module: string; curveId: bigint }) =>
    ref.module === 'CSM' && ref.curveId === 2n ? 'CSM_ICS' : undefined,
}));

vi.mock('@lidofinance/lido-csm-sdk/abi', () => ({ VettedGateAbi: [{ name: 'VettedGateAbi' }] }));

import { gateLabel, gatesFor, gatesStorageKey, fetchGates, getCachedGates } from '../../lib/background/gate-cache.js';
import { clearClientCache } from '../../lib/background/client.js';
import type { CacheContext } from '../../lib/shared/types.js';

const CTX: CacheContext = { chainId: 1, moduleType: 'csm', rpcUrl: 'https://rpc.example' };

function treeOf(addresses: string[]) {
  return { entries: () => addresses.map((a, i) => [i, [a]] as const)[Symbol.iterator]() };
}

/** Routes multicall by functionName so tests read like per-gate fixtures. */
function chain(opts: {
  config: Record<string, [string, string, bigint, boolean] | Error>;
  consumed?: Record<string, boolean>;
}) {
  mockMulticall.mockImplementation(async ({ contracts }: { contracts: { address: string; functionName: string; args?: string[] }[] }) => {
    if (contracts[0]?.functionName === 'treeRoot') {
      const cfg = opts.config[contracts[0].address];
      if (cfg instanceof Error) throw cfg;
      if (!cfg) throw new Error(`no config for ${contracts[0].address}`);
      return cfg;
    }
    return contracts.map((c) => opts.consumed?.[c.args![0]!.toLowerCase()] ?? false);
  });
}

// test/setup.ts stubs chrome.storage with bare vi.fn()s — back them with a map so the
// stored tree survives between fetchGates calls.
let store: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  clearClientCache();
  store = {};
  vi.mocked(chrome.storage.local.get).mockImplementation((async (key: string) => ({ [key]: store[key] })) as never);
  vi.mocked(chrome.storage.local.set).mockImplementation((async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  }) as never);
});

describe('gateLabel', () => {
  it('strips gate prefixes and suffixes', () => {
    expect(gateLabel('icsGate')).toBe('ICS');
    expect(gateLabel('idvtcGate')).toBe('IDVTC');
    expect(gateLabel('curatedGatePTO')).toBe('PTO');
    expect(gateLabel('curatedGateIODCP')).toBe('IODCP');
  });
});

describe('gatesFor', () => {
  it('lists vetted and curated gates, never the permissionless one', () => {
    expect(gatesFor('csm', 1).map((g) => g.gate)).toEqual(['icsGate', 'idvtcGate']);
    expect(gatesFor('cm', 1)).toEqual([{ gate: 'curatedGatePTO', address: PTO }]);
  });

  it('returns nothing for a module with no gates or no config on the chain', () => {
    expect(gatesFor('csm02', 560048)).toEqual([]);
    expect(gatesFor('csm02', 1)).toEqual([]);
  });
});

describe('fetchGates', () => {
  it('keeps only unconsumed leaves, checksummed, and caches the entry', async () => {
    chain({
      config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] },
      consumed: { [ADDR_B.toLowerCase()]: true },
    });
    mockFetchTree.mockResolvedValue(treeOf([ADDR_A.toLowerCase(), ADDR_B.toLowerCase(), ADDR_C.toLowerCase()]));

    const entry = await fetchGates(CTX);

    expect(entry.gates).toEqual([
      {
        gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS', paused: false,
        unconsumed: [getAddress(ADDR_A), getAddress(ADDR_C)], leafCount: 3,
      },
    ]);
    expect(await getCachedGates(CTX)).toEqual(entry);
    expect(gatesStorageKey(CTX)).toBe('gates_csm_1');
  });

  it('fetches the tree from IPFS gateways first, then the GitHub fallback, against the on-chain root', async () => {
    chain({ config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    mockFetchTree.mockResolvedValue(treeOf([]));

    await fetchGates(CTX);

    expect(mockFetchTree).toHaveBeenCalledWith({
      urls: [`https://${CID}.ipfs.dweb.link/`, `https://gateway.pinata.cloud/ipfs/${CID}`, 'https://github.example/ics.json'],
      root: ROOT_1,
    });
  });

  it('reuses the stored tree while the on-chain root is unchanged, but rechecks consumption', async () => {
    chain({ config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    mockFetchTree.mockResolvedValue(treeOf([ADDR_A]));
    await fetchGates(CTX);

    chain({
      config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] },
      consumed: { [ADDR_A.toLowerCase()]: true },
    });
    const entry = await fetchGates(CTX);

    expect(mockFetchTree).toHaveBeenCalledTimes(1);
    expect(entry.gates[0]?.unconsumed).toEqual([]);
  });

  it('re-downloads when the on-chain root changed', async () => {
    chain({ config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    mockFetchTree.mockResolvedValue(treeOf([ADDR_A]));
    await fetchGates(CTX);

    chain({ config: { [ICS]: [ROOT_2, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    mockFetchTree.mockResolvedValue(treeOf([ADDR_B]));
    const entry = await fetchGates(CTX);

    expect(mockFetchTree).toHaveBeenCalledTimes(2);
    expect(entry.gates[0]?.unconsumed).toEqual([getAddress(ADDR_B)]);
  });

  it('isolates a failing gate: it carries an error, the others still land', async () => {
    chain({ config: { [ICS]: [ROOT_1, CID, 2n, true], [IDVTC]: new Error('execution reverted') } });
    mockFetchTree.mockResolvedValue(treeOf([ADDR_A]));

    const entry = await fetchGates(CTX);

    expect(entry.gates.map((g) => [g.gate, g.paused, g.error])).toEqual([
      ['icsGate', true, undefined],
      ['idvtcGate', false, 'execution reverted'],
    ]);
    expect(entry.gates[1]?.unconsumed).toEqual([]);
  });

  it('marks a gate errored when no tree URL serves a tree matching the root', async () => {
    chain({ config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    mockFetchTree.mockResolvedValue(null);

    const entry = await fetchGates(CTX);

    expect(entry.gates[0]?.error).toMatch(/tree/i);
  });

  it('resolves Anvil gates through the forked chain but caches under 31337', async () => {
    chain({ config: { [ICS]: [zeroHash, '', 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    const anvil: CacheContext = { chainId: 31337, moduleType: 'csm', rpcUrl: 'http://127.0.0.1:8545', forkedFrom: 1 };

    await fetchGates(anvil);

    expect(mockMulticall).toHaveBeenCalled();
    expect(await getCachedGates(anvil)).not.toBeNull();
    expect(gatesStorageKey(anvil)).toBe('gates_csm_31337');
  });

  it('reuses the tree stored for the forked chain, keyed by contract chain id not chainId', async () => {
    chain({ config: { [ICS]: [ROOT_1, CID, 2n, false], [IDVTC]: [zeroHash, '', 4n, false] } });
    mockFetchTree.mockResolvedValue(treeOf([ADDR_A]));
    await fetchGates(CTX);
    expect(mockFetchTree).toHaveBeenCalledTimes(1);

    const anvil: CacheContext = { chainId: 31337, moduleType: 'csm', rpcUrl: 'http://127.0.0.1:8545', forkedFrom: 1 };
    const entry = await fetchGates(anvil);

    expect(mockFetchTree).toHaveBeenCalledTimes(1);
    expect(entry.gates[0]?.unconsumed).toEqual([getAddress(ADDR_A)]);
  });

  it('makes no RPC call for a module without gates', async () => {
    const entry = await fetchGates({ chainId: 560048, moduleType: 'csm02', rpcUrl: 'https://rpc.example' });
    expect(entry.gates).toEqual([]);
    expect(mockMulticall).not.toHaveBeenCalled();
  });
});
