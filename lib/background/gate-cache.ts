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
  type CONTRACT_NAMES,
} from '@lidofinance/lido-csm-sdk/common';
import { VettedGateAbi } from '@lidofinance/lido-csm-sdk/abi';
import type { SupportedChainId } from '../shared/networks.js';
import type { CacheContext, CachedGate, GateCacheEntry, ModuleType } from '../shared/types.js';
import { errorMessage } from '../shared/errors.js';
import { MODULE_NAMES, contractChainId, getClient } from './client.js';

const VETTED_GATES = ['icsGate', 'idvtcGate'];
// viem's 1 KB default would split a 500-leaf tree into ~18 eth_calls (~36 B calldata per isConsumed).
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
  const client = getClient(ctx);
  const read = await Promise.all(contracts.map((c) => readGate(client, ctx, ccid, c)));
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
  const key = treeStorageKey(ccid, gate);
  const stored = (await chrome.storage.local.get(key))[key] as StoredTree | undefined;
  if (stored && stored.root.toLowerCase() === root.toLowerCase()) return stored.leaves;

  const fallback: string | undefined =
    MERKLE_TREE_FALLBACKS[MODULE_NAMES[ctx.moduleType]]?.[ccid]?.[gate as CONTRACT_NAMES];
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
