# Gate Proofs on the Shared Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface addresses holding an unconsumed gate merkle proof (ICS, IDVTC, CM curated gates) as a new attachment kind on the Shared tab and in the connected bar's "Attached to" panel.

**Architecture:** A service-worker `gate-cache.ts` (sibling of `operator-cache.ts`) reads each gate's tree config via multicall, fetches the tree with the SDK's `fetchTree` (IPFS → GitHub fallback, root-verified), multicalls `isConsumed`, and caches unconsumed addresses per (module, chain). The popup requests gates next to operators; `buildAttachmentIndex` folds them in as `GateAttachment`s, so Shared rows, selection and the hover panel reuse existing UI.

**Tech Stack:** WXT, React, viem (`multicall`), `@lidofinance/lido-csm-sdk` (`/common`, `/abi`), vitest + testing-library, raw Playwright e2e.

**Spec:** `docs/brainstorms/2026-09-25-gate-proofs.md`

## Global Constraints

- TypeScript imports use `.js` extensions.
- Comments: none by default; only a non-obvious *why*, 1–2 lines. JSDoc on exports: one line.
- `chrome.storage` can't hold BigInts — `curveId` stored as a string.
- Gate reads use one ABI (`VettedGateAbi`) for every gate: `treeRoot()`, `treeCid()`, `curveId()`, `isPaused()`, `isConsumed(address)` have identical signatures in `CuratedGateAbi` (verified).
- Gate fetch failures never broadcast the popup `error` event — operators already surface RPC failures; gates degrade to a per-gate `error` field.
- Storage keys: `gates_${moduleType}_${chainId}` (popup entry), `gate_tree_${chainId}_${gate}` (`{ root, leaves }`). Stale after 30 min.
- Gate label = contract name with `curatedGate` prefix / `Gate` suffix stripped, uppercased (`icsGate` → `ICS`, `curatedGateIODCP` → `IODCP`).
- Gate attachment identity = (moduleType, gate). `attachmentKey`: `${moduleType}:op:${id}` / `${moduleType}:gate:${gate}`.
- Shared filters: All / Cross-module / Pending / Claimer require `attachments.length > 1` (gates count); Gate requires `entry.gate`, any count.
- Commits: plain `git commit` (repo signs with `4A07D67C`). Never `--no-gpg-sign`. No co-author trailer.

## Review Focus

1. Tree leaves are lowercase hex; operator addresses are checksummed — the same address must land in ONE index entry with both attachments (Task 2 checksums leaves; Task 4 test).
2. On-chain root changed since the stored tree → must re-download, never reuse stale leaves; forced refresh with an unchanged root must still re-run `isConsumed` (Anvil join then refresh) — Task 2 tests.
3. Every gate URL dead / RPC down → that gate carries `error`, other gates still land, no popup error banner — Tasks 2 and 3 tests.
4. Network switch while gates are in flight → a late `gates-update` for the previous chain is ignored — Task 5 test.
5. Five chips + staleness + refresh must fit the 440px popup filter bar without overflow — Task 7 e2e asserts `scrollWidth <= clientWidth`.

---

### Task 1: Shared viem client module

Pure refactor so both caches share one client pool.

**Files:**
- Create: `lib/background/client.ts`
- Modify: `lib/background/operator-cache.ts` (remove moved code, import from `client.js`)
- Test: existing `test/background/operator-cache.test.ts` (must pass unchanged)

**Interfaces:**
- Produces: `MODULE_NAMES: Record<ModuleType, MODULE_NAME>`, `contractChainId(ctx: CacheContext): SupportedChainId`, `getClient(ctx: CacheContext): PublicClient`, `clearClientCache(): void`, `isStale(entry: { lastFetchedAt: number }): boolean`, `STALE_MS`.
- `operator-cache.ts` keeps re-exporting `clearClientCache` and `isStale` (background.ts and tests import them from there).

- [ ] **Step 1: Create `lib/background/client.ts`** — move verbatim from `operator-cache.ts`: `MODULE_NAMES`, `contractChainId`, `clientCache`, `getClient`, `clearClientCache`, `STALE_MS`, and `isStale` with its parameter widened:

```ts
export function isStale(entry: { lastFetchedAt: number }): boolean {
  return Date.now() - entry.lastFetchedAt > STALE_MS;
}
```

- [ ] **Step 2: Update `operator-cache.ts`** — delete the moved declarations, add:

```ts
import { MODULE_NAMES, contractChainId, getClient } from './client.js';
export { clearClientCache, isStale } from './client.js';
```

- [ ] **Step 3: Verify**

Run: `pnpm run typecheck && pnpm vitest run test/background`
Expected: PASS, no test edits.

- [ ] **Step 4: Commit**

```bash
git add lib/background/client.ts lib/background/operator-cache.ts
git commit -m "refactor: share viem client between background caches"
```

---

### Task 2: Gate cache

**Files:**
- Modify: `lib/shared/types.ts` (add `CachedGate`, `GateCacheEntry`)
- Create: `lib/background/gate-cache.ts`
- Test: `test/background/gate-cache.test.ts`

**Interfaces:**
- Consumes: Task 1 `MODULE_NAMES`, `contractChainId`, `getClient`.
- Produces:
  ```ts
  // lib/shared/types.ts
  export type CachedGate = {
    gate: string; label: string; curveId: string; operatorType: string;
    paused: boolean; unconsumed: Address[]; leafCount: number; error?: string;
  };
  export type GateCacheEntry = { gates: CachedGate[]; lastFetchedAt: number };
  // lib/background/gate-cache.ts
  export function gateLabel(gate: string): string;
  export function gatesFor(moduleType: ModuleType, chainId: SupportedChainId): { gate: string; address: Address }[];
  export function gatesStorageKey(ctx: CacheContext): string;
  export async function getCachedGates(ctx: CacheContext): Promise<GateCacheEntry | null>;
  export async function fetchGates(ctx: CacheContext): Promise<GateCacheEntry>;
  ```

- [ ] **Step 1: Add types to `lib/shared/types.ts`** (after `OperatorCacheEntry`):

```ts
/** A gate's unconsumed tree leaves. `error` set → the gate couldn't be read; its lists are empty. */
export type CachedGate = {
  gate: string; // SDK contract name: 'icsGate', 'curatedGatePTO'
  label: string; // 'ICS', 'PTO'
  curveId: string; // bigint serialized
  operatorType: string; // the type an operator joining through this gate gets, 'CC' if unknown
  paused: boolean;
  unconsumed: Address[];
  leafCount: number;
  error?: string;
};

export type GateCacheEntry = {
  gates: CachedGate[];
  lastFetchedAt: number;
};
```

- [ ] **Step 2: Write the failing tests** — `test/background/gate-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { zeroHash, getAddress } from 'viem';
import { ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';

const { mockMulticall, mockFetchTree } = vi.hoisted(() => ({
  mockMulticall: vi.fn(),
  mockFetchTree: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual('viem');
  return { ...actual, createPublicClient: vi.fn(() => ({ multicall: mockMulticall })), http: vi.fn() };
});

const ICS = '0x1000000000000000000000000000000000000001';
const IDVTC = '0x1000000000000000000000000000000000000002';
const PTO = '0x2000000000000000000000000000000000000001';
const ROOT_1 = `0x${'11'.repeat(32)}`;
const ROOT_2 = `0x${'22'.repeat(32)}`;
const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

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

  it('makes no RPC call for a module without gates', async () => {
    const entry = await fetchGates({ chainId: 560048, moduleType: 'csm02', rpcUrl: 'https://rpc.example' });
    expect(entry.gates).toEqual([]);
    expect(mockMulticall).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/background/gate-cache.test.ts`
Expected: FAIL — cannot resolve `gate-cache.js`.

- [ ] **Step 4: Implement `lib/background/gate-cache.ts`**

```ts
import { getAddress, zeroHash, type Address, type Hex, type PublicClient } from 'viem';
import {
  CURATED_GATES,
  DEFAULT_IPFS_GATEWAYS,
  MERKLE_TREE_FALLBACKS,
  MODULE_CONFIG,
  fetchTree,
  getOperatorTypeByCurveId,
  isValidIpfsCid,
  toCidV1Base32,
} from '@lidofinance/lido-csm-sdk/common';
import { VettedGateAbi } from '@lidofinance/lido-csm-sdk/abi';
import type { SupportedChainId } from '../shared/networks.js';
import type { CacheContext, CachedGate, GateCacheEntry, ModuleType } from '../shared/types.js';
import { errorMessage } from '../shared/errors.js';
import { MODULE_NAMES, contractChainId, getClient } from './client.js';

const VETTED_GATES = ['icsGate', 'idvtcGate'];
// viem's 1 KB default would split a 500-leaf tree into ~100 eth_calls.
const CONSUMED_BATCH_BYTES = 32_768;

type GateContract = { gate: string; address: Address };
type StoredTree = { root: Hex; leaves: Address[] };

/** 'icsGate' → 'ICS', 'curatedGatePTO' → 'PTO'. */
export function gateLabel(gate: string): string {
  return gate.replace(/^curatedGate/, '').replace(/Gate$/, '').toUpperCase();
}

/** Gates with a merkle tree deployed for this module on this chain. */
export function gatesFor(moduleType: ModuleType, chainId: SupportedChainId): GateContract[] {
  const addresses: Record<string, Address | undefined> =
    MODULE_CONFIG[MODULE_NAMES[moduleType]][chainId]?.contractAddresses ?? {};
  return [...VETTED_GATES, ...CURATED_GATES].flatMap((gate) => {
    const address = addresses[gate];
    return address ? [{ gate, address }] : [];
  });
}

export function gatesStorageKey(ctx: CacheContext): string {
  return `gates_${ctx.moduleType}_${ctx.chainId}`;
}

function treeStorageKey(chainId: number, gate: string): string {
  return `gate_tree_${chainId}_${gate}`;
}

export async function getCachedGates(ctx: CacheContext): Promise<GateCacheEntry | null> {
  const key = gatesStorageKey(ctx);
  const data = await chrome.storage.local.get(key);
  return (data[key] as GateCacheEntry | undefined) ?? null;
}

export async function fetchGates(ctx: CacheContext): Promise<GateCacheEntry> {
  const ccid = contractChainId(ctx);
  const contracts = gatesFor(ctx.moduleType, ccid);
  const client = contracts.length ? getClient(ctx) : null;
  const read = await Promise.all(contracts.map((c) => readGate(client!, ctx, ccid, c)));
  const entry: GateCacheEntry = {
    gates: read.filter((g): g is CachedGate => g !== null),
    lastFetchedAt: Date.now(),
  };
  await chrome.storage.local.set({ [gatesStorageKey(ctx)]: entry });
  return entry;
}

async function readGate(
  client: PublicClient,
  ctx: CacheContext,
  ccid: SupportedChainId,
  { gate, address }: GateContract,
): Promise<CachedGate | null> {
  const label = gateLabel(gate);
  try {
    const call = { address, abi: VettedGateAbi } as const;
    const [treeRoot, treeCid, curveId, paused] = await client.multicall({
      allowFailure: false,
      contracts: [
        { ...call, functionName: 'treeRoot' },
        { ...call, functionName: 'treeCid' },
        { ...call, functionName: 'curveId' },
        { ...call, functionName: 'isPaused' },
      ],
    });
    if (treeRoot === zeroHash) return null;

    const leaves = await loadLeaves(ctx, ccid, gate, treeRoot, treeCid);
    const consumed = leaves.length
      ? await client.multicall({
          allowFailure: false,
          batchSize: CONSUMED_BATCH_BYTES,
          contracts: leaves.map((leaf) => ({ ...call, functionName: 'isConsumed', args: [leaf] }) as const),
        })
      : [];

    return {
      gate,
      label,
      curveId: curveId.toString(),
      operatorType: getOperatorTypeByCurveId(ccid, { module: MODULE_NAMES[ctx.moduleType], curveId }) ?? 'CC',
      paused,
      unconsumed: leaves.filter((_, i) => !consumed[i]),
      leafCount: leaves.length,
    };
  } catch (err) {
    return {
      gate, label, curveId: '', operatorType: 'CC', paused: false,
      unconsumed: [], leafCount: 0, error: errorMessage(err),
    };
  }
}

async function loadLeaves(
  ctx: CacheContext,
  ccid: SupportedChainId,
  gate: string,
  root: Hex,
  cid: string,
): Promise<Address[]> {
  const key = treeStorageKey(ctx.chainId, gate);
  const stored = (await chrome.storage.local.get(key))[key] as StoredTree | undefined;
  if (stored && stored.root.toLowerCase() === root.toLowerCase()) return stored.leaves;

  const fallback: string | undefined =
    MERKLE_TREE_FALLBACKS[MODULE_NAMES[ctx.moduleType]]?.[ccid]?.[gate as keyof object];
  const urls = [...ipfsUrls(cid), ...(fallback ? [fallback] : [])];
  const tree = await fetchTree<[Address]>({ urls, root });
  if (!tree) throw new Error('No tree URL served a tree matching the on-chain root');

  const leaves = [...tree.entries()].map(([, [leaf]]) => getAddress(leaf));
  await chrome.storage.local.set({ [key]: { root, leaves } satisfies StoredTree });
  return leaves;
}

function ipfsUrls(cid: string): string[] {
  if (!isValidIpfsCid(cid)) return [];
  // subdomain gateways can't carry base58 CIDv0 — DNS labels are case-insensitive
  const v1 = toCidV1Base32(cid);
  return DEFAULT_IPFS_GATEWAYS.map((g) => (g.includes('{cid}') ? g.replace('{cid}', v1) : `${g}${v1}`));
}
```

If the SDK types reject `MERKLE_TREE_FALLBACKS[...][ccid][gate]` indexing or `fetchTree`'s generic, adjust the cast locally — keep behaviour identical. If `fetchTree` throws instead of returning null when every URL fails, the surrounding `try` already maps that to `error`; keep the null check too.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/background/gate-cache.test.ts && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/shared/types.ts lib/background/gate-cache.ts test/background/gate-cache.test.ts
git commit -m "feat(gates): cache unconsumed gate proofs per module and chain"
```

---

### Task 3: Background protocol for gates

**Files:**
- Modify: `lib/shared/messages.ts` (commands + events)
- Modify: `entrypoints/background.ts` (context helper, generic cached refresh, two new commands)
- Test: `test/background/request-gates.test.ts` (new); existing `test/background/*.test.ts` must still pass

**Interfaces:**
- Consumes: Task 2 `fetchGates`, `getCachedGates`; Task 1 `isStale`.
- Produces (messages.ts):
  ```ts
  | { type: 'request-gates'; origin: string; chainId: number; moduleType: ModuleType }
  | { type: 'refresh-gates'; origin: string; chainId: number; moduleType: ModuleType }
  // PopupEvent
  | { type: 'gates-update'; chainId: number; moduleType: ModuleType; gates: import('./types.js').CachedGate[]; lastFetchedAt: number }
  | { type: 'gates-loading'; chainId: number; moduleType: ModuleType; loading: boolean }
  ```

- [ ] **Step 1: Add the message types** to `PopupCommand` and `PopupEvent` in `lib/shared/messages.ts` exactly as above.

- [ ] **Step 2: Write the failing test** — copy the whole mock/stub preamble of `test/background/request-operators.test.ts` (lines 1–90: `defineBackground` capture, state/anvil/operator-cache/rpc-handler/approval/favorites/rpc mocks, chrome stubs, `beforeEach`) into `test/background/request-gates.test.ts`, then add a gate-cache mock and the tests. Read the rest of `request-operators.test.ts` first and reuse its port helper (how it connects a fake port and collects `postMessage` events) rather than inventing another.

```ts
const fetchGates = vi.fn();
const getCachedGates = vi.fn();
vi.mock('../../lib/background/gate-cache.ts', () => ({ fetchGates, getCachedGates }));

// in beforeEach, after the copied setup:
getCachedGates.mockResolvedValue(null);
fetchGates.mockResolvedValue({ gates: [], lastFetchedAt: 1 });

const GATE = {
  gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS',
  paused: false, unconsumed: [ADDR_A], leafCount: 1,
};

describe('request-gates', () => {
  it('broadcasts a fresh cache without refetching', async () => {
    getCachedGates.mockResolvedValue({ gates: [GATE], lastFetchedAt: Date.now() });
    const events = await send({ type: 'request-gates', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(events).toContainEqual({ type: 'gates-update', chainId: 1, moduleType: 'csm', gates: [GATE], lastFetchedAt: expect.any(Number) });
    expect(fetchGates).not.toHaveBeenCalled();
  });

  it('fetches on a cold cache, bracketed by gates-loading', async () => {
    fetchGates.mockResolvedValue({ gates: [GATE], lastFetchedAt: 5 });
    const events = await send({ type: 'request-gates', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    const types = events.filter((e) => e.type.startsWith('gates-')).map((e) => e.type === 'gates-loading' ? `loading:${e.loading}` : e.type);
    expect(types).toEqual(['loading:true', 'gates-update', 'loading:false']);
  });

  it('never broadcasts an error banner when the gate fetch fails', async () => {
    fetchGates.mockRejectedValue(new Error('rpc down'));
    const events = await send({ type: 'request-gates', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events).toContainEqual({ type: 'gates-loading', chainId: 1, moduleType: 'csm', loading: false });
  });

  it('still replies on an unsupported network', async () => {
    const events = await send({ type: 'request-gates', origin: TEST_ORIGIN, chainId: 999, moduleType: 'csm' });
    expect(events).toContainEqual({ type: 'gates-loading', chainId: 999, moduleType: 'csm', loading: false });
  });

  it('still replies on Anvil without a detectable fork', async () => {
    detectAnvilFork.mockResolvedValue(null);
    const events = await send({ type: 'request-gates', origin: TEST_ORIGIN, chainId: 31337, moduleType: 'csm' });
    expect(events).toContainEqual({ type: 'gates-loading', chainId: 31337, moduleType: 'csm', loading: false });
  });

  it('uses the forked chain on Anvil', async () => {
    getForkedFrom.mockResolvedValue(1);
    await send({ type: 'request-gates', origin: TEST_ORIGIN, chainId: 31337, moduleType: 'csm' });
    expect(fetchGates).toHaveBeenCalledWith(expect.objectContaining({ chainId: 31337, forkedFrom: 1 }));
  });
});

describe('refresh-gates', () => {
  it('refetches even when the cache is fresh', async () => {
    getCachedGates.mockResolvedValue({ gates: [GATE], lastFetchedAt: Date.now() });
    await send({ type: 'refresh-gates', origin: TEST_ORIGIN, chainId: 1, moduleType: 'csm' });
    expect(fetchGates).toHaveBeenCalledTimes(1);
  });
});
```

(`send` = the reused port helper: post the command, await handling, return every broadcast `PopupEvent`.)

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run test/background/request-gates.test.ts`
Expected: FAIL — commands unhandled.

- [ ] **Step 4: Implement in `entrypoints/background.ts`**

(a) Import `fetchGates`, `getCachedGates` from `../lib/background/gate-cache.js`, and `ModuleType` type.

(b) Replace `triggerRefresh` with a generic helper plus two thin wrappers. Keep `inFlightRefreshes` (keys are now prefixed so operators and gates never collide):

```ts
type CachedRefresh<E extends { lastFetchedAt: number }> = {
  key: string;
  getCached: () => Promise<E | null>;
  fetch: () => Promise<E>;
  update: (entry: E) => void;
  loading: (loading: boolean) => void;
  fail: (err: unknown) => void;
};

async function refreshCached<E extends { lastFetchedAt: number }>(r: CachedRefresh<E>, force: boolean) {
  const cached = await r.getCached();
  if (cached) {
    r.update(cached);
    if (!force && !isStale(cached)) return;
  }
  const running = inFlightRefreshes.get(r.key);
  if (running) return running;
  const task = (async () => {
    r.loading(true);
    try {
      r.update(await r.fetch());
    } catch (err: unknown) {
      r.fail(err);
    } finally {
      r.loading(false);
    }
  })();
  inFlightRefreshes.set(r.key, task);
  try {
    await task;
  } finally {
    inFlightRefreshes.delete(r.key);
  }
}

function triggerRefresh(ctx: CacheContext, force = false) {
  const { chainId, moduleType } = ctx;
  return refreshCached({
    key: `operators:${moduleType}:${chainId}`,
    getCached: () => getCachedOperators(ctx),
    fetch: () => fetchOperators(ctx),
    update: (e) => broadcastToPopups({ type: 'operators-update', chainId, moduleType, operators: e.operators, lastFetchedAt: e.lastFetchedAt }),
    loading: (loading) => broadcastToPopups({ type: 'operators-loading', chainId, moduleType, loading }),
    fail: (err) => broadcastToPopups({ type: 'error', message: `Failed to fetch operators: ${errorMessage(err)}` }),
  }, force);
}

function triggerGateRefresh(ctx: CacheContext, force = false) {
  const { chainId, moduleType } = ctx;
  return refreshCached({
    key: `gates:${moduleType}:${chainId}`,
    getCached: () => getCachedGates(ctx),
    fetch: () => fetchGates(ctx),
    update: (e) => broadcastToPopups({ type: 'gates-update', chainId, moduleType, gates: e.gates, lastFetchedAt: e.lastFetchedAt }),
    loading: (loading) => broadcastToPopups({ type: 'gates-loading', chainId, moduleType, loading }),
    // Operators already surface RPC failures; a banner per gate fetch would double it.
    fail: (err) => console.warn('Gate fetch failed:', err),
  }, force);
}
```

(c) Extract the context resolution shared by `request-operators` / `refresh-operators` (Anvil fork detection + `setForkedFrom`, custom RPC, unsupported chain) into:

```ts
async function resolveCacheContext(chainId: number, moduleType: ModuleType): Promise<CacheContext | null> {
  const globalSettings = await getGlobalSettings();
  if (chainId === ANVIL_CHAIN_ID) {
    const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
    let forkedFrom = await getForkedFrom();
    if (!forkedFrom) {
      forkedFrom = await detectAnvilFork(rpcUrl);
      if (forkedFrom) await setForkedFrom(forkedFrom);
    }
    return forkedFrom ? { chainId, moduleType, rpcUrl, forkedFrom } : null;
  }
  const supported = chainId as SupportedChainId;
  if (!SUPPORTED_CHAIN_IDS.includes(supported)) return null;
  const rpcUrl = globalSettings.customRpcUrls[chainId] ?? DEFAULT_NETWORKS[supported]?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl;
  return { chainId, moduleType, rpcUrl };
}
```

Rewrite the four cases on top of it, preserving today's operator behaviour exactly (request replies `loading:false` when no context; refresh does nothing):

```ts
case 'request-operators': {
  const ctx = await resolveCacheContext(command.chainId, command.moduleType);
  if (ctx) await triggerRefresh(ctx);
  else broadcastToPopups({ type: 'operators-loading', chainId: command.chainId, moduleType: command.moduleType, loading: false });
  break;
}
case 'refresh-operators': {
  const ctx = await resolveCacheContext(command.chainId, command.moduleType);
  if (ctx) await triggerRefresh(ctx, true);
  break;
}
case 'request-gates': {
  const ctx = await resolveCacheContext(command.chainId, command.moduleType);
  if (ctx) await triggerGateRefresh(ctx);
  else broadcastToPopups({ type: 'gates-loading', chainId: command.chainId, moduleType: command.moduleType, loading: false });
  break;
}
case 'refresh-gates': {
  const ctx = await resolveCacheContext(command.chainId, command.moduleType);
  if (ctx) await triggerGateRefresh(ctx, true);
  else broadcastToPopups({ type: 'gates-loading', chainId: command.chainId, moduleType: command.moduleType, loading: false });
  break;
}
```

Other `triggerRefresh(ctx)` call sites (e.g. around lines 350/365) keep working — same signature.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/background && pnpm run typecheck`
Expected: PASS — all existing background tests unchanged. If an existing test mocks `operator-cache.ts` and the background now fails to import `gate-cache.ts` under it, add `vi.mock('../../lib/background/gate-cache.ts', () => ({ fetchGates: vi.fn(), getCachedGates: vi.fn().mockResolvedValue(null) }))` to that test file.

- [ ] **Step 6: Commit**

```bash
git add lib/shared/messages.ts entrypoints/background.ts test/background
git commit -m "feat(gates): request-gates/refresh-gates protocol"
```

---

### Task 4: Gates as attachments

**Files:**
- Modify: `lib/shared/types.ts` (`AddressSource` gate variant)
- Modify: `playwright/types.ts` (same variant in the public copy of `AddressSource`, with a one-line JSDoc)
- Modify: `lib/shared/attachments.ts`
- Test: `test/popup/attachments.test.ts`

**Interfaces:**
- Consumes: Task 2 `CachedGate`.
- Produces:
  ```ts
  // types.ts
  | { type: 'gate'; gate: string }            // in AddressSource
  // attachments.ts
  export type OperatorAttachment; export type GateAttachment; export type Attachment = OperatorAttachment | GateAttachment;
  export function attachmentKey(att: Attachment): string;
  export function buildAttachmentIndex(byModule, gatesByModule?: Partial<Record<ModuleType, CachedGate[]>>): Map<string, AddressAttachments>;
  export function gateLabels(entry: AddressAttachments): string[];
  export function attachSummary(entry: AddressAttachments): string;   // '2 ops · ICS'
  export function gatePillHint(att: GateAttachment): string;
  // AddressAttachments gains: gate: boolean
  ```

- [ ] **Step 1: Write the failing tests** — append to `test/popup/attachments.test.ts` (extend its import list with `attachmentKey`, `gateLabels`, `attachSummary`, `gatePillHint`, and `import type { CachedGate } from '../../lib/shared/types.js'`):

```ts
function makeGate(overrides: Partial<CachedGate> = {}): CachedGate {
  return {
    gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS',
    paused: false, unconsumed: [], leafCount: 10, ...overrides,
  };
}

describe('gate attachments', () => {
  it('adds a gate attachment for each unconsumed address', () => {
    const index = buildAttachmentIndex({}, { csm: [makeGate({ unconsumed: [ADDR_C] })] });
    const entry = index.get(ADDR_C.toLowerCase())!;
    expect(entry.attachments).toEqual([
      {
        type: 'gate', moduleType: 'csm', gate: 'icsGate', gateLabel: 'ICS', paused: false,
        operatorType: 'CSM_ICS', curveId: '2', typeLabel: 'CSM·ICS', kind: 'csm-ics',
      },
    ]);
    expect(entry.gate).toBe(true);
  });

  it('merges a lowercase tree leaf with the checksummed operator address into one entry', () => {
    const op = makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B });
    const index = buildAttachmentIndex(
      { csm: [op] },
      { csm: [makeGate({ unconsumed: [ADDR_A.toLowerCase() as `0x${string}`] })] },
    );
    const entry = index.get(ADDR_A.toLowerCase())!;
    expect(entry.address).toBe(ADDR_A);
    expect(entry.attachments.map((a) => a.type)).toEqual(['operator', 'gate']);
  });

  it('keeps the gate badge even when the curve is unknown', () => {
    const index = buildAttachmentIndex({}, { cm: [makeGate({ gate: 'curatedGatePTO', label: 'PTO', operatorType: 'CC' })] });
    expect(index.size).toBe(0);
    const withLeaf = buildAttachmentIndex({}, {
      cm: [makeGate({ gate: 'curatedGatePTO', label: 'PTO', operatorType: 'CC', unconsumed: [ADDR_D] })],
    });
    const att = withLeaf.get(ADDR_D.toLowerCase())!.attachments[0]!;
    expect(att.typeLabel).toBe('CM·PTO');
    expect(att.kind).toBe('cc');
  });

  it('skips errored gates', () => {
    const index = buildAttachmentIndex({}, { csm: [makeGate({ unconsumed: [ADDR_C], error: 'boom' })] });
    expect(index.size).toBe(0);
  });

  it('never counts gates as pending or claimer', () => {
    const index = buildAttachmentIndex({}, { csm: [makeGate({ unconsumed: [ADDR_C] })] });
    const entry = index.get(ADDR_C.toLowerCase())!;
    expect(entry.pending).toBe(false);
    expect(entry.claimer).toBe(false);
  });

  it('keys operator and gate attachments apart', () => {
    const index = buildAttachmentIndex(
      { csm: [makeOperator({ id: '7', managerAddress: ADDR_A })] },
      { csm: [makeGate({ unconsumed: [ADDR_A] })] },
    );
    expect(index.get(ADDR_A.toLowerCase())!.attachments.map(attachmentKey)).toEqual(['csm:op:7', 'csm:gate:icsGate']);
  });
});

describe('sharedAddresses with gates', () => {
  it('includes a gate-only address, but only in its own module', () => {
    const index = buildAttachmentIndex({}, { cm: [makeGate({ gate: 'curatedGatePTO', label: 'PTO', unconsumed: [ADDR_C] })] });
    expect(sharedAddresses(index, 'cm').map((e) => e.address)).toEqual([ADDR_C]);
    expect(sharedAddresses(index, 'csm')).toEqual([]);
  });
});

describe('gate counts and hints', () => {
  const index = buildAttachmentIndex(
    { csm: [makeOperator({ id: '7', managerAddress: ADDR_A }), makeOperator({ id: '8', managerAddress: ADDR_A })] },
    { csm: [makeGate({ unconsumed: [ADDR_A, ADDR_C] }), makeGate({ gate: 'idvtcGate', label: 'IDVTC', unconsumed: [ADDR_C] })] },
  );
  const both = index.get(ADDR_A.toLowerCase())!;
  const gatesOnly = index.get(ADDR_C.toLowerCase())!;

  it('counts operators per module, then lists gate labels', () => {
    expect(moduleCounts(both)).toEqual({ csm: 2 });
    expect(countLabel(both)).toBe('2 CSM · ICS');
    expect(countLabel(gatesOnly)).toBe('ICS · IDVTC');
    expect(gateLabels(gatesOnly)).toEqual(['ICS', 'IDVTC']);
  });

  it('describes operators and unused proofs in the count hint', () => {
    expect(countHint(both)).toBe('Attached to 2 CSM operators · unused ICS proof.');
    expect(countHint(gatesOnly)).toBe('Unused ICS and IDVTC proofs.');
  });

  it('summarises for the hover trigger', () => {
    expect(attachSummary(both)).toBe('2 ops · ICS');
    expect(attachSummary(gatesOnly)).toBe('ICS · IDVTC');
  });

  it('hints the gate pill by paused state', () => {
    const att = gatesOnly.attachments[0]!;
    if (att.type !== 'gate') throw new Error('expected gate');
    expect(gatePillHint(att)).toBe('Unused proof in the ICS gate tree');
    expect(gatePillHint({ ...att, paused: true })).toBe('ICS gate paused — proof unused, joining blocked');
  });
});
```

Existing tests that build attachments by hand or read `att.operatorId` / `att.pills` may need `type: 'operator'` added or a narrowing — update them minimally; their expectations must not change.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/popup/attachments.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Add `{ type: 'gate'; gate: string }` to `AddressSource`** in `lib/shared/types.ts` (between `operator` and `anvil`) and in `playwright/types.ts` with JSDoc `/** Picked from an unused gate proof on the Shared tab — provenance only. */`.

- [ ] **Step 4: Implement in `lib/shared/attachments.ts`**

Replace the `Attachment` / `AddressAttachments` types:

```ts
type AttachmentBase = {
  moduleType: ModuleType;
  operatorType: string; // raw, e.g. 'CSM_DEF' or the 'CC' fallback
  curveId: string; // BigInt kept as string end to end — chrome.storage can't hold BigInts
  typeLabel: string; // 'CSM·DEF' — module prefix restored for cross-module display
  kind: string; // 'csm-def' — ribbon colour class suffix
};

/** One operator an address is attached to, with every role it holds there. */
export type OperatorAttachment = AttachmentBase & {
  type: 'operator';
  operatorId: string;
  primaryRole: AddressRole; // role to attribute a selection to
  pills: RoleEntry[];
};

/** An unused proof for this address in a gate's merkle tree. Identity is (moduleType, gate). */
export type GateAttachment = AttachmentBase & {
  type: 'gate';
  gate: string;
  gateLabel: string;
  paused: boolean;
};

export type Attachment = OperatorAttachment | GateAttachment;

export type AddressAttachments = {
  address: Address;
  attachments: Attachment[];
  modules: ModuleType[];
  crossModule: boolean;
  pending: boolean; // holds at least one proposed role
  claimer: boolean; // holds a claimer role on any attachment
  gate: boolean; // holds an unused proof in at least one gate
};

export function attachmentKey(att: Attachment): string {
  return att.type === 'gate' ? `${att.moduleType}:gate:${att.gate}` : `${att.moduleType}:op:${att.operatorId}`;
}
```

Rewrite `buildAttachmentIndex`:

```ts
export function buildAttachmentIndex(
  byModule: Partial<Record<ModuleType, CachedOperator[]>>,
  gatesByModule: Partial<Record<ModuleType, CachedGate[]>> = {},
): Map<string, AddressAttachments> {
  const index = new Map<string, AddressAttachments>();
  const entryFor = (address: Address) => {
    const key = address.toLowerCase();
    let entry = index.get(key);
    if (!entry) {
      entry = { address, attachments: [], modules: [], crossModule: false, pending: false, claimer: false, gate: false };
      index.set(key, entry);
    }
    return entry;
  };

  for (const moduleType of MODULE_ORDER) {
    for (const op of byModule[moduleType] ?? []) {
      const perAddress = new Map<string, OperatorAttachment>();
      for (const e of roleEntries(op)) {
        const key = e.address.toLowerCase();
        let att = perAddress.get(key);
        if (!att) {
          att = {
            type: 'operator',
            moduleType,
            operatorId: op.id,
            operatorType: op.operatorType,
            curveId: op.curveId,
            typeLabel: attachmentTypeLabel(moduleType, op.operatorType),
            kind: operatorKind(op.operatorType),
            primaryRole: e.role,
            pills: [],
          };
          perAddress.set(key, att);
        }
        att.pills.push(e);
      }
      for (const att of perAddress.values()) {
        const first = att.pills[0];
        if (first) entryFor(first.address).attachments.push(att);
      }
    }
  }

  // After every operator, so an address's operator rows always lead its gate rows.
  for (const moduleType of MODULE_ORDER) {
    for (const g of gatesByModule[moduleType] ?? []) {
      if (g.error) continue;
      for (const address of g.unconsumed) {
        entryFor(address).attachments.push({
          type: 'gate',
          moduleType,
          gate: g.gate,
          gateLabel: g.label,
          paused: g.paused,
          operatorType: g.operatorType,
          curveId: g.curveId,
          typeLabel: `${MODULE_SHORT[moduleType]}·${g.label}`,
          kind: operatorKind(g.operatorType),
        });
      }
    }
  }

  for (const entry of index.values()) {
    const ops = entry.attachments.filter((a): a is OperatorAttachment => a.type === 'operator');
    entry.modules = MODULE_ORDER.filter((m) => entry.attachments.some((a) => a.moduleType === m));
    entry.crossModule = entry.modules.length > 1;
    entry.pending = ops.some((a) => a.pills.some((p) => p.proposed));
    entry.claimer = ops.some((a) => a.pills.some((p) => p.role === 'claimer'));
    entry.gate = entry.attachments.length > ops.length;
  }

  return index;
}
```

Note: the operator entry's display `address` comes from the first role pill (checksummed); a gate-first entry would take the leaf as given — Task 2 checksums leaves, so both are checksummed.

`sharedAddresses`: change the first filter to `.filter((e) => e.attachments.length > 1 || e.gate)` and update its JSDoc to "Addresses held by more than one attachment, or holding an unused gate proof, with at least one attachment in `inModule` — most attachments first."

Counts and hints:

```ts
export function moduleCounts(entry: AddressAttachments): Partial<Record<ModuleType, number>> {
  const counts: Partial<Record<ModuleType, number>> = {};
  for (const a of entry.attachments) {
    if (a.type === 'operator') counts[a.moduleType] = (counts[a.moduleType] ?? 0) + 1;
  }
  return counts;
}

export function gateLabels(entry: AddressAttachments): string[] {
  return [...new Set(entry.attachments.flatMap((a) => (a.type === 'gate' ? [a.gateLabel] : [])))];
}

/** '2 CSM · 1 CM', '2 CSM · ICS', 'ICS · PTO'. */
export function countLabel(entry: AddressAttachments): string {
  const counts = moduleCounts(entry);
  const ops = MODULE_ORDER.filter((m) => counts[m]).map((m) => `${counts[m]} ${MODULE_SHORT[m]}`);
  return [...ops, ...gateLabels(entry)].join(' · ');
}

/** Hover trigger text: '2 ops · ICS', '1 op', 'ICS'. */
export function attachSummary(entry: AddressAttachments): string {
  const n = entry.attachments.filter((a) => a.type === 'operator').length;
  return [...(n ? [`${n} ${n === 1 ? 'op' : 'ops'}`] : []), ...gateLabels(entry)].join(' · ');
}

export function countHint(entry: AddressAttachments): string {
  const counts = moduleCounts(entry);
  const parts = MODULE_ORDER.filter((m) => counts[m]).map(
    (m) => `${counts[m]} ${MODULE_LABEL[m]} operator${counts[m] === 1 ? '' : 's'}`,
  );
  const gates = gateLabels(entry);
  const clauses = [
    ...(parts.length ? [`Attached to ${joinList(parts)}`] : []),
    ...(gates.length ? [`${parts.length ? 'unused' : 'Unused'} ${joinList(gates)} proof${gates.length === 1 ? '' : 's'}`] : []),
  ];
  const base = clauses.join(' · ');
  if (entry.modules.length === 2) return `${base} — spans both modules.`;
  if (entry.modules.length > 2) return `${base} — spans ${entry.modules.length} modules.`;
  return `${base}.`;
}

export function gatePillHint(att: GateAttachment): string {
  return att.paused
    ? `${att.gateLabel} gate paused — proof unused, joining blocked`
    : `Unused proof in the ${att.gateLabel} gate tree`;
}
```

`typeHint(att, …)` keeps working (it only reads `AttachmentBase` fields). Import `CachedGate` type from `./types.js`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm vitest run test/popup/attachments.test.ts`
Expected: PASS. Then `pnpm run typecheck` — expect errors only in popup components / hooks consuming `att.operatorId` (fixed in Tasks 5–6). Do not fix those here beyond the minimum needed to typecheck `lib/`: if `lib/popup/hooks.ts` fails, narrow with `a.type === 'operator' &&` at the flagged spots.

- [ ] **Step 6: Commit**

```bash
git add lib/shared/types.ts playwright/types.ts lib/shared/attachments.ts lib/popup/hooks.ts test/popup/attachments.test.ts
git commit -m "feat(gates): gate proofs as address attachments"
```

---

### Task 5: Popup hook — gates next to operators, Gate filter

**Files:**
- Modify: `lib/popup/hooks.ts` (`useSharedAddresses`, `SharedFilter`, `filterSharedAddresses`)
- Test: `test/popup/use-shared-addresses.test.ts`

**Interfaces:**
- Consumes: Task 3 messages; Task 4 `buildAttachmentIndex(byModule, gatesByModule)`.
- Produces: `SharedFilter = 'all' | 'cross' | 'pending' | 'claimer' | 'gate'`; `useSharedAddresses(...)` returns `{ addresses, index, loading, lastFetchedAt, refresh, gatesLoading: boolean, gateErrors: string[] }` (`gateErrors` = labels of gates with `error`, across wanted modules, in `MODULE_ORDER`).

- [ ] **Step 1: Write the failing tests** — append to `test/popup/use-shared-addresses.test.ts` (read the existing file first for how it emits `PopupEvent`s into the mock port, e.g. `port.emit(...)` inside `act`, and reuse exactly that):

```ts
const ICS_GATE = {
  gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS',
  paused: false, unconsumed: [ADDR_C], leafCount: 3,
};

describe('useSharedAddresses — gates', () => {
  it('requests gates for every wanted module', () => {
    render(TWO_MODULE);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    expect(sent.filter((c) => c.type === 'request-gates').map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'cm']);
  });

  it('folds gate-only addresses into the index without holding operator loading', () => {
    const { result } = render(TWO_MODULE);
    act(() => {
      emit({ type: 'operators-update', chainId: 1, moduleType: 'csm', operators: [], lastFetchedAt: 1 });
      emit({ type: 'operators-update', chainId: 1, moduleType: 'cm', operators: [], lastFetchedAt: 1 });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.gatesLoading).toBe(true);

    act(() => {
      emit({ type: 'gates-update', chainId: 1, moduleType: 'csm', gates: [ICS_GATE], lastFetchedAt: 1 });
      emit({ type: 'gates-update', chainId: 1, moduleType: 'cm', gates: [], lastFetchedAt: 1 });
    });
    expect(result.current.gatesLoading).toBe(false);
    expect(result.current.addresses.map((e) => e.address)).toEqual([ADDR_C]);
  });

  it('ignores a late gates-update for another chain', () => {
    const { result } = render(TWO_MODULE);
    act(() => emit({ type: 'gates-update', chainId: 560048, moduleType: 'csm', gates: [ICS_GATE], lastFetchedAt: 1 }));
    expect(result.current.index.size).toBe(0);
  });

  it('settles gates on a failed fetch and reports errored gates by label', () => {
    const { result } = render(TWO_MODULE);
    act(() => {
      emit({ type: 'gates-update', chainId: 1, moduleType: 'csm', gates: [{ ...ICS_GATE, error: 'dead' }], lastFetchedAt: 1 });
      emit({ type: 'gates-loading', chainId: 1, moduleType: 'cm', loading: false });
    });
    expect(result.current.gatesLoading).toBe(false);
    expect(result.current.gateErrors).toEqual(['ICS']);
  });

  it('refresh also refreshes gates', () => {
    const { result } = render(TWO_MODULE);
    port.postMessage.mockClear();
    act(() => result.current.refresh());
    const sent = port.postMessage.mock.calls.map(([c]) => (c as PopupCommand).type);
    expect(sent.filter((t) => t === 'refresh-gates')).toHaveLength(2);
  });
});

describe('filterSharedAddresses — gate', () => {
  const index = buildAttachmentIndex(
    { csm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B }), makeOperator({ id: '8', managerAddress: ADDR_A, rewardsAddress: ADDR_B })] },
    { csm: [{ ...ICS_GATE, unconsumed: [ADDR_C, ADDR_A] }] },
  );
  const list = sharedAddresses(index, 'csm');

  it('All excludes a gate-only address; Gate includes it and the operator one', () => {
    expect(filterSharedAddresses(list, '', 'all').map((e) => e.address)).not.toContain(ADDR_C);
    expect(filterSharedAddresses(list, '', 'gate').map((e) => e.address).sort()).toEqual([ADDR_A, ADDR_C].sort());
  });

  it('#N matches operators only; @ics and plain text match gates', () => {
    expect(filterSharedAddresses(list, '#7', 'gate').map((e) => e.address)).toEqual([ADDR_A]);
    expect(filterSharedAddresses(list, '@ics', 'gate').map((e) => e.address).sort()).toEqual([ADDR_A, ADDR_C].sort());
    expect(filterSharedAddresses(list, 'ics', 'gate')).toHaveLength(2);
  });
});
```

Define `const emit = (e: PopupEvent) => port._emit(e);` at the top of the new describe — `_emit` is the mock port's delivery helper in `test/setup.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run test/popup/use-shared-addresses.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement in `lib/popup/hooks.ts`**

In `useSharedAddresses`, next to the operator state:

```ts
const [gatesByModule, setGatesByModule] = useState<Partial<Record<ModuleType, CachedGate[]>>>({});
const [gatesLoadingModules, setGatesLoadingModules] = useState<ModuleType[]>([]);
const [gatesSettled, setGatesSettled] = useState<ModuleType[]>([]);
```

In the effect: reset all three alongside the operator resets; add a `settleGates` twin of `settle`; handle in `handler`:

```ts
if (event.type === 'gates-update') {
  if (event.chainId !== chainIdRef.current || !wanted.includes(event.moduleType)) return;
  setGatesByModule((prev) => ({ ...prev, [event.moduleType]: event.gates }));
  settleGates(event.moduleType);
}
if (event.type === 'gates-loading') {
  if (event.chainId !== chainIdRef.current || !wanted.includes(event.moduleType)) return;
  setGatesLoadingModules((prev) =>
    event.loading
      ? (prev.includes(event.moduleType) ? prev : [...prev, event.moduleType])
      : prev.filter((m) => m !== event.moduleType),
  );
  if (!event.loading) settleGates(event.moduleType);
}
```

In the request loop post `request-gates` after `request-operators` for each module; in `refresh` post `refresh-gates` after `refresh-operators`. Then:

```ts
const index = useMemo(() => buildAttachmentIndex(byModule, gatesByModule), [byModule, gatesByModule]);

const gatesAnswered = wanted.filter((m) => gatesSettled.includes(m)).length;
const gatesLoading = enabled && (gatesLoadingModules.length > 0 || gatesAnswered < wanted.length);
const gateErrors = useMemo(
  () => MODULE_ORDER.flatMap((m) => (wanted.includes(m) ? gatesByModule[m] ?? [] : []).filter((g) => g.error).map((g) => g.label)),
  [gatesByModule, wanted],
);

return { addresses, index, loading, lastFetchedAt, refresh, gatesLoading, gateErrors };
```

`loading` and `lastFetchedAt` stay operator-only.

`filterSharedAddresses`:

```ts
export type SharedFilter = 'all' | 'cross' | 'pending' | 'claimer' | 'gate';

const scoped = list.filter((e) => {
  // Gate is a sibling of All, not a subset: it is the only view that lists gate-only addresses.
  if (filter === 'gate') return e.gate;
  if (e.attachments.length < 2) return false;
  if (filter === 'cross') return e.crossModule;
  if (filter === 'pending') return e.pending;
  if (filter === 'claimer') return e.claimer;
  return true;
});
```

Search branches:
- `#`: `e.attachments.some((a) => a.type === 'operator' && a.operatorId === id)`
- `@`: `e.attachments.some((a) => matchesTypeQuery(a.operatorType, q) || (a.type === 'gate' && a.gateLabel.toLowerCase() === q))`
- text: `(a) => (a.type === 'operator' && a.operatorId.includes(q)) || a.typeLabel.toLowerCase().includes(q)`

Import `CachedGate` type.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run test/popup/use-shared-addresses.test.ts test/popup/hooks.test.ts`
Expected: PASS, existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/popup/hooks.ts test/popup/use-shared-addresses.test.ts
git commit -m "feat(gates): request gates with operators; Gate filter"
```

---

### Task 6: UI — gate row, Gate chip, hover trigger, selection

**Files:**
- Modify: `entrypoints/popup/AttachmentRow.tsx`, `entrypoints/popup/SharedAddresses.tsx`, `entrypoints/popup/AttachedOperators.tsx`, `entrypoints/popup/ConnectedBar.tsx`, `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`
- Test: `test/popup/shared-addresses.test.tsx`, `test/popup/attached-operators.test.tsx`, `test/popup/connected-bar.test.tsx`, plus a new `test/popup/gate-selection.test.tsx` only if App-level selection isn't reachable from an existing App test (check `test/popup/app-*.test.tsx` first and extend one of those if it renders App with a mock port).

**Interfaces:**
- Consumes: Task 4 `Attachment`, `attachmentKey`, `attachSummary`, `gatePillHint`; Task 5 `gatesLoading`, `gateErrors`, `SharedFilter` with `'gate'`.
- Produces:
  - `SharedAddresses` props: `onSelect: (address: string, attachment: Attachment) => void`, plus `gatesLoading: boolean`, `gateErrors: string[]`.
  - `AttachedOperators` / `ConnectedBar` `onSelect` / `onSelectAttachment`: `(attachment: Attachment) => void`.

- [ ] **Step 1: Update existing tests to the new `onSelect` shape** (behaviour unchanged):
  - `shared-addresses.test.tsx`: `expect(onSelect).toHaveBeenCalledWith(ADDR_A, expect.objectContaining({ type: 'operator', operatorId: '7', primaryRole: 'manager', moduleType: 'cm' }))` in place of `(ADDR_A, '7', 'manager', 'cm')` (same for the csm variant); pass `gatesLoading={false} gateErrors={[]}` in the render helper defaults.
  - `attached-operators.test.tsx`: `expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: 'operator', operatorId: '7', primaryRole: 'manager', moduleType: 'cm' }))`. The trigger text for operator-only entries is unchanged (`attachSummary` returns `'N op(s)'`), so existing trigger assertions stay.

- [ ] **Step 2: Write the new failing tests**

`shared-addresses.test.tsx` (build entries with `buildAttachmentIndex` + `sharedAddresses`, as the file already does):

```ts
const ICS_GATE = { gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS', paused: false, unconsumed: [ADDR_C], leafCount: 3 };
const gateOnly = sharedAddresses(buildAttachmentIndex({}, { csm: [ICS_GATE] }), 'csm');

it('lists a gate-only address under the Gate chip only', () => {
  const { container, getByText } = renderTab({ addresses: gateOnly });
  expect(container.querySelectorAll('.addr-card')).toHaveLength(0);
  fireEvent.click(getByText('Gate'));
  expect(container.querySelectorAll('.addr-card')).toHaveLength(1);
});

it('renders a gate row with a PROOF pill and selects it as a gate attachment', () => {
  const { container, getByText, onSelect } = renderTab({ addresses: gateOnly });
  fireEvent.click(getByText('Gate'));
  fireEvent.click(container.querySelector('.addr-head')!);
  const row = container.querySelector('.attach-row.gate')!;
  expect(row.textContent).toContain('CSM·ICS');
  expect(row.querySelector('.role-pill')!.textContent).toBe('PROOF');
  fireEvent.click(row);
  expect(onSelect).toHaveBeenCalledWith(ADDR_C, expect.objectContaining({ type: 'gate', gate: 'icsGate', moduleType: 'csm' }));
});

it('shows PAUSED for a paused gate', () => {
  const paused = sharedAddresses(buildAttachmentIndex({}, { csm: [{ ...ICS_GATE, paused: true }] }), 'csm');
  const { container, getByText } = renderTab({ addresses: paused });
  fireEvent.click(getByText('Gate'));
  fireEvent.click(container.querySelector('.addr-head')!);
  expect(container.querySelector('.attach-row.gate .role-pill')!.textContent).toBe('PAUSED');
});

it('shows a gate-tree spinner under Gate while gates load', () => {
  const { getByText } = renderTab({ addresses: [], gatesLoading: true });
  fireEvent.click(getByText('Gate'));
  expect(getByText('Loading gate trees…')).toBeInTheDocument();
});

it('shows the gate empty state once gates settle with nothing', () => {
  const { getByText } = renderTab({ addresses: [], gatesLoading: false });
  fireEvent.click(getByText('Gate'));
  expect(getByText('No unused gate proofs')).toBeInTheDocument();
});

it('warns about unavailable gate trees', () => {
  const { container } = renderTab({ gateErrors: ['ICS', 'PTO'] });
  expect(container.querySelector('.gate-warn')!.getAttribute('data-hint')).toBe('Gate tree unavailable: ICS, PTO');
});
```

`attached-operators.test.tsx`:

```ts
it('summarises operators and gates in the trigger and lists the gate row', () => {
  const index = buildAttachmentIndex(
    { csm: [makeOperator({ id: '7', managerAddress: ADDR_A })] },
    { csm: [{ gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS', paused: false, unconsumed: [ADDR_A], leafCount: 1 }] },
  );
  const { container, onSelect } = renderPanel({ entry: index.get(ADDR_A.toLowerCase()) });
  expect(container.querySelector('.ops-trigger')!.textContent).toBe('1 op · ICS');
  fireEvent.click(container.querySelector('.ops-pop .attach-row.gate')!);
  expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: 'gate', gate: 'icsGate' }));
});
```

App-level (extend an existing App test that renders with a mock port, or create `gate-selection.test.tsx` following `app-active-tab.test.tsx`'s setup): feed state with `activeTab: 'shared'`, availability `{ csm: true, cm: false, csm02: false }`, `operators-update` for csm `[]`, `gates-update` for csm `[ICS_GATE]`; click **Gate**, expand the card, click the gate row; assert the port received:

```ts
expect.objectContaining({ type: 'select-address', address: ADDR_C, source: { type: 'gate', gate: 'icsGate' } })
```

and, for a CM gate while the site is on CSM (`cm: true` available, CM gate, then switch the scope so the CM entry is visible — or connect-bar hover path), that `moduleType: 'cm'` is included. If the second case is awkward at App level, cover it with a unit test of the extracted `selectAttachment` source-builder (Step 3d) instead.

- [ ] **Step 3: Implement**

(a) `AttachmentRow.tsx` — narrow props: `attachment: Attachment`; operator branch unchanged; add before it:

```tsx
if (att.type === 'gate') {
  return (
    <div className={`attach-row gate kind-${att.kind}`} onClick={onSelect}>
      <span className="attach-ribbon" />
      <span className="attach-id mono gate-id">gate</span>
      <span className="attach-type hint" data-hint={typeHint(att, siteModuleType)}>{att.typeLabel}</span>
      <div className="spacer" />
      <div className="chip-pills">
        <span
          className={`role-pill hint hint-right ${att.paused ? 'dashed' : 'tint-gate'}`}
          data-hint={gatePillHint(att)}
        >
          {att.paused ? 'PAUSED' : 'PROOF'}
        </span>
      </div>
    </div>
  );
}
```

(b) `SharedAddresses.tsx` — add `['gate', 'Gate']` after Claimer; hint `gate: 'Addresses with an unused gate proof — including ones not on any operator'`. Props `gatesLoading`, `gateErrors`; `onSelect(address, att)`. Before the staleness label:

```tsx
{gateErrors.length > 0 && (
  <span className="gate-warn hint hint-right" data-hint={`Gate tree unavailable: ${gateErrors.join(', ')}`}>⚠</span>
)}
```

Loading / empty:

```tsx
const gateView = filter === 'gate';
const busy = gateView ? gatesLoading : loading;
// spinner when busy && shown.length === 0, text: gateView ? 'Loading gate trees…' : 'Loading operators...'
// empty headline: gateView ? 'No unused gate proofs' : 'No shared addresses'
// empty hint: gateView
//   ? "Addresses in a gate's merkle tree that haven't used their proof yet show up here."
//   : existing text
```

Rows in `AddressCard`:

```tsx
{entry.attachments.map((att) =>
  att.type === 'operator' ? (
    <AttachmentRow
      key={attachmentKey(att)}
      attachment={att}
      siteModuleType={siteModuleType}
      label={operatorLabels.get(att.operatorId, att.moduleType)}
      onSetLabel={(l) => operatorLabels.set(att.operatorId, l, att.moduleType)}
      onSelect={() => onSelect(entry.address, att)}
    />
  ) : (
    <AttachmentRow
      key={attachmentKey(att)}
      attachment={att}
      siteModuleType={siteModuleType}
      label=""
      editableLabel={false}
      onSelect={() => onSelect(entry.address, att)}
    />
  ),
)}
```

(c) `AttachedOperators.tsx` — trigger text `{attachSummary(entry)}`; `onSelect: (att: Attachment) => void`; row `key={attachmentKey(att)}`, `label={att.type === 'operator' ? operatorLabel(att.operatorId, att.moduleType) : ''}`, `onSelect={() => onSelect(att)}`. `ConnectedBar.tsx`: `onSelectAttachment?: (att: Attachment) => void`, passed through.

(d) `App.tsx` — one builder used by both the connected bar and the Shared tab:

```ts
const selectAttachment = (address: string, att: Attachment) =>
  send({
    type: 'select-address',
    address,
    source: att.type === 'gate'
      ? { type: 'gate', gate: att.gate }
      : { type: 'operator', operatorId: att.operatorId, role: att.primaryRole },
    // Only sent when it differs, so same-module picks keep the existing behaviour.
    ...(att.moduleType !== state.moduleType ? { moduleType: att.moduleType } : {}),
  });
```

ConnectedBar: `onSelectAttachment={(att) => selectAttachment(state.selectedAddress!.address, att)}`. SharedAddresses: `onSelect={selectAttachment}`, `gatesLoading={sharedAddrs.gatesLoading}`, `gateErrors={sharedAddrs.gateErrors}`.

(e) `style.css` — next to the other tints:

```css
/* Takes the row's ribbon colour, so the pill matches the operator type the gate grants. */
.role-pill.tint-gate {
  background: color-mix(in srgb, var(--ribbon-color) 16%, transparent);
  color: var(--ribbon-color);
}

.attach-id.gate-id {
  color: var(--dim);
}

.gate-warn {
  font-size: 11px;
  color: var(--warn);
}
```

If `--ribbon-color` is only set on the `.attach-ribbon` element rather than the row, confirm `.kind-*` classes sit on `.attach-row` (they do — `attach-row kind-${kind}`), so the variable inherits.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm run test && pnpm run typecheck && pnpm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/popup test/popup
git commit -m "feat(gates): gate rows, Gate filter and gate selection in the popup"
```

---

### Task 7: E2E + docs

**Files:**
- Modify: `test/e2e/helpers.ts` (add `seedGates`)
- Create: `test/e2e/gate-proofs.e2e.ts`
- Modify: `test/e2e/shared-addresses.e2e.ts`, `test/e2e/attached-operators.e2e.ts` (seed empty gate caches so they stay hermetic)
- Modify: `CLAUDE.md` (file structure + gotchas)

**Interfaces:**
- Consumes: storage key `gates_${moduleType}_${chainId}` and `GateCacheEntry` (Task 2); UI selectors `.filter-btn` text `Gate`, `.attach-row.gate`, `.role-pill` text `PROOF`, `.ops-trigger`, `.ops-pop` (Task 6).
- Produces: `seedGates(sw, gates: CachedGate[], chainId: number, moduleType?: ModuleType)`.

- [ ] **Step 1: Add `seedGates` to `test/e2e/helpers.ts`** (after `seedOperators`, same shape):

```ts
export async function seedGates(
  sw: Worker,
  gates: CachedGate[],
  chainId: number,
  moduleType: ModuleType = 'csm',
) {
  const key = `gates_${moduleType}_${chainId}`;
  const entry: GateCacheEntry = { gates, lastFetchedAt: Date.now() };
  await sw.evaluate(
    async ([k, v]) => {
      await chrome.storage.local.set({ [k]: v });
    },
    [key, entry] as const,
  );
}
```

- [ ] **Step 2: Keep existing specs hermetic** — in `shared-addresses.e2e.ts` `seedFresh()` and the equivalent seeding in `attached-operators.e2e.ts`, add `await seedGates(sw, [], 1, 'csm'); await seedGates(sw, [], 1, 'cm');` (match the chain ids those specs use).

- [ ] **Step 3: Write `test/e2e/gate-proofs.e2e.ts`** (structure copied from `shared-addresses.e2e.ts`):

```ts
/**
 * E2E: Gate proofs — gate attachments on the Shared tab and the connected bar.
 *
 * Run: npx tsx test/e2e/gate-proofs.e2e.ts
 * Requires: pnpm run build first
 */
import {
  launchExtension, openPopup, seedOperators, seedGates, seedState,
  seedModuleAvailability, goToTab, fillSearch, createRunner,
} from './helpers.js';
import type { CachedGate, CachedOperator } from '../../lib/shared/types.js';

const GATE_ONLY = '0x1111111111111111111111111111111111111111';
const OP_AND_GATE = '0x2222222222222222222222222222222222222222';
const REWARDS = '0x3333333333333333333333333333333333333333';

const CSM_OPS: CachedOperator[] = [
  { id: '12', managerAddress: OP_AND_GATE, rewardsAddress: REWARDS, extendedManagerPermissions: true, curveId: '0', operatorType: 'CSM_DEF' },
];

const ICS: CachedGate = {
  gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS',
  paused: false, unconsumed: [GATE_ONLY, OP_AND_GATE], leafCount: 5,
};

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  async function seedFresh() {
    await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
    await seedOperators(sw, CSM_OPS, 1, 'csm');
    await seedOperators(sw, [], 1, 'cm');
    await seedGates(sw, [ICS], 1, 'csm');
    await seedGates(sw, [], 1, 'cm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: true });
  }

  async function openShared() {
    const page = await openPopup(context, extensionId);
    await goToTab(page, 'Shared');
    return page;
  }

  try {
    await test('An operator address with an unused proof is shared under All', async () => {
      await seedFresh();
      const page = await openShared();
      const card = page.locator('.addr-card', { hasText: OP_AND_GATE.slice(0, 6) });
      await card.waitFor();
      const count = await card.locator('.attach-count').innerText();
      if (count.trim() !== '1 CSM · ICS') throw new Error(`count: ${count}`);
      if (await page.locator('.addr-card', { hasText: GATE_ONLY.slice(0, 6) }).count()) {
        throw new Error('gate-only address leaked into All');
      }
      await page.close();
    });

    await test('The Gate chip lists the gate-only address', async () => {
      await seedFresh();
      const page = await openShared();
      await page.locator('.filter-btn', { hasText: 'Gate' }).click();
      await page.locator('.addr-card', { hasText: GATE_ONLY.slice(0, 6) }).waitFor();
      await page.close();
    });

    await test('The filter bar fits the popup with five chips', async () => {
      await seedFresh();
      const page = await openShared();
      const overflow = await page.locator('.filter-bar').evaluate((el) => el.scrollWidth - el.clientWidth);
      if (overflow > 0) throw new Error(`filter bar overflows by ${overflow}px`);
      await page.close();
    });

    await test('@ics finds gate addresses', async () => {
      await seedFresh();
      const page = await openShared();
      await page.locator('.filter-btn', { hasText: 'Gate' }).click();
      await fillSearch(page, '@ics');
      await page.locator('.addr-card').first().waitFor();
      const n = await page.locator('.addr-card').count();
      if (n !== 2) throw new Error(`expected 2 cards, got ${n}`);
      await page.close();
    });

    await test('Selecting a gate row connects the address; the hover lists the gate', async () => {
      await seedFresh();
      const page = await openShared();
      await page.locator('.filter-btn', { hasText: 'Gate' }).click();
      const card = page.locator('.addr-card', { hasText: GATE_ONLY.slice(0, 6) });
      await card.locator('.addr-head').click();
      const row = card.locator('.attach-row.gate');
      await row.waitFor();
      if ((await row.locator('.role-pill').innerText()).trim() !== 'PROOF') throw new Error('missing PROOF pill');
      await row.click();
      const trigger = page.locator('.ops-trigger');
      await trigger.waitFor();
      if ((await trigger.innerText()).trim() !== 'ICS') throw new Error('trigger label');
      if ((await page.locator('.ops-pop .attach-row.gate').count()) !== 1) throw new Error('hover gate row missing');
      await page.close();
    });
  } finally {
    await context.close();
  }
  summary();
}

main();
```

Align `summary()` / `context.close()` / `fillSearch` usage with how `shared-addresses.e2e.ts` ends and searches — mirror it exactly.

- [ ] **Step 4: Run e2e**

Run: `pnpm run test:e2e`
Expected: all suites pass, including `gate-proofs.e2e.ts`. If the filter-bar overflow test fails, shrink `.filter-btn` horizontal padding in `style.css` (e.g. `padding: 3px 8px`) or hide `.staleness-label` below a width via the existing layout — re-run.

- [ ] **Step 5: Update `CLAUDE.md`**

File Structure — under `lib/background/` note `gate-cache.ts — unconsumed gate proofs per module/chain` and `client.ts — shared viem client`.

Gotchas — add:

```md
- **Gate proofs are attachments:** `buildAttachmentIndex` takes operator caches *and* gate caches;
  a `GateAttachment` is keyed on (module, gate), never an operator id. Only unconsumed leaves
  are surfaced. The Shared **Gate** chip is a sibling of All, not a subset — it is the only view
  listing gate-only addresses; All still needs >1 attachment (gates count).
- **Gate cache is split:** `gates_${module}_${chainId}` holds what the popup needs; the full leaf
  list lives in `gate_tree_${chainId}_${gate}` keyed by root, so a refresh with an unchanged
  on-chain root re-runs `isConsumed` without re-downloading the tree. Gate failures never raise
  the popup error banner — a failed gate carries `error` and shows as ⚠ on the Shared tab.
- **E2E seeds gates too:** specs that open Shared or connect an address seed `seedGates(...)`
  (even `[]`), or the worker fetches real trees from IPFS/GitHub mid-test.
```

- [ ] **Step 6: Commit**

```bash
git add test/e2e CLAUDE.md
git commit -m "test(gates): e2e for gate proofs; document gate attachments"
```
