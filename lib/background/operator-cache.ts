import { createPublicClient, http, zeroAddress, type Address, type PublicClient, type Chain } from 'viem';
import {
  COMMON_CONTRACT_ADDRESSES,
  CSM_MODULE_IDS,
  CM_MODULE_IDS,
  CSM_OPERATOR_TYPE_CURVE_ID,
  CM_OPERATOR_TYPE_CURVE_ID,
  type OperatorType,
} from '@lidofinance/lido-csm-sdk/common';
import { SMDiscoveryAbi } from '@lidofinance/lido-csm-sdk/abi';
import { DEFAULT_NETWORKS, type SupportedChainId } from '../shared/networks.js';
import type { CachedOperator, CacheContext, ModuleType, OperatorCacheEntry } from '../shared/types.js';

const STALE_MS = 30 * 60 * 1000; // 30 minutes
const AVAILABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 500n;

const MODULE_IDS: Record<ModuleType, Record<SupportedChainId, number>> = {
  csm: CSM_MODULE_IDS as Record<SupportedChainId, number>,
  cm: CM_MODULE_IDS as Record<SupportedChainId, number>,
};

const CURVE_ID_MAPS = {
  csm: CSM_OPERATOR_TYPE_CURVE_ID,
  cm: CM_OPERATOR_TYPE_CURVE_ID,
} as const;

/** The chain whose contracts/ABIs to use — forkedFrom for Anvil, chainId otherwise */
function contractChainId(ctx: CacheContext): SupportedChainId {
  return (ctx.forkedFrom ?? ctx.chainId) as SupportedChainId;
}

// ── Client cache ──

const clientCache = new Map<string, PublicClient>();

function getClient(ctx: CacheContext): PublicClient {
  const ccid = contractChainId(ctx);
  const network = DEFAULT_NETWORKS[ccid];
  const key = `${ccid}:${ctx.rpcUrl}`;

  let client = clientCache.get(key);
  if (!client) {
    const isCustom = ctx.rpcUrl !== network.rpcUrl;
    client = createPublicClient({
      chain: network.viemChain as Chain,
      transport: http(ctx.rpcUrl, {
        timeout: isCustom ? 120_000 : 10_000,
      }),
    });
    clientCache.set(key, client);
  }
  return client;
}

export function clearClientCache() {
  clientCache.clear();
}

// ── Module availability cache ──

const availabilityCache = new Map<string, { available: boolean; checkedAt: number }>();

function availabilityStorageKey(chainId: number): string {
  return `module_availability_${chainId}`;
}

export async function getModuleAvailabilityCache(
  chainId: number,
): Promise<{ csm: boolean; cm: boolean } | null> {
  const key = availabilityStorageKey(chainId);
  const data = await chrome.storage.local.get(key);
  const entry = data[key] as { csm: boolean; cm: boolean; checkedAt: number } | undefined;
  return entry ? { csm: entry.csm, cm: entry.cm } : null;
}

export async function setModuleAvailabilityCache(
  chainId: number,
  modules: { csm: boolean; cm: boolean },
): Promise<void> {
  const key = availabilityStorageKey(chainId);
  await chrome.storage.local.set({ [key]: { ...modules, checkedAt: Date.now() } });
}

function resolveOperatorType(moduleType: ModuleType, curveId: bigint): OperatorType {
  const mapping = CURVE_ID_MAPS[moduleType];
  const entry = Object.entries(mapping).find(([, id]) => id === curveId);
  return (entry?.[0] ?? 'CC') as OperatorType;
}

export function storageKey(ctx: CacheContext): string {
  return `operators_${ctx.moduleType}_${ctx.chainId}`;
}

function getDiscoveryAddress(chainId: SupportedChainId): Address {
  const addresses = COMMON_CONTRACT_ADDRESSES[chainId as keyof typeof COMMON_CONTRACT_ADDRESSES];
  const addr = addresses?.SMDiscovery;
  if (!addr) throw new Error(`No SMDiscovery address for chain ${chainId}`);
  return addr;
}

export async function isModuleAvailable(ctx: CacheContext): Promise<boolean> {
  const ccid = contractChainId(ctx);
  const memKey = `${ctx.moduleType}:${ctx.chainId}`;
  const hit = availabilityCache.get(memKey);
  if (hit && Date.now() - hit.checkedAt < AVAILABILITY_TTL_MS) return hit.available;

  // Check persistent cache — uses ctx.chainId (fixes Anvil/Hoodi sharing bug)
  const persisted = await getModuleAvailabilityCache(ctx.chainId);
  if (persisted && ctx.moduleType === 'cm' && persisted.cm) {
    availabilityCache.set(memKey, { available: true, checkedAt: Date.now() });
    return true;
  }

  const client = getClient(ctx);

  try {
    const discoveryAddress = getDiscoveryAddress(ccid);
    const moduleId = BigInt(MODULE_IDS[ctx.moduleType][ccid]);
    const [moduleAddress] = await client.readContract({
      address: discoveryAddress,
      abi: SMDiscoveryAbi,
      functionName: 'moduleCache',
      args: [moduleId],
    });
    const available = moduleAddress !== zeroAddress;
    availabilityCache.set(memKey, { available, checkedAt: Date.now() });
    return available;
  } catch {
    availabilityCache.set(memKey, { available: false, checkedAt: Date.now() });
    return false;
  }
}

/** Fetch all operators via RPC, cache under ctx.chainId namespace */
export async function fetchOperators(ctx: CacheContext): Promise<OperatorCacheEntry> {
  const ccid = contractChainId(ctx);
  const client = getClient(ctx);
  const discoveryAddress = getDiscoveryAddress(ccid);
  const moduleId = BigInt(MODULE_IDS[ctx.moduleType][ccid]);

  // Paginate through all operators
  const allRaw: Awaited<ReturnType<typeof readOperatorBatch>>[number][] = [];
  let offset = 0n;

  while (true) {
    const batch = await readOperatorBatch(client, discoveryAddress, moduleId, offset);
    allRaw.push(...batch);
    if (BigInt(batch.length) < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const operators: CachedOperator[] = allRaw.map((info) => {
    const curveId = BigInt(info.curveId);
    const ownerAddress = info.extendedManagerPermissions
      ? info.managerAddress
      : info.rewardAddress;

    return {
      id: BigInt(info.id).toString(),
      managerAddress: info.managerAddress,
      rewardsAddress: info.rewardAddress, // SDK uses singular "rewardAddress"
      proposedManagerAddress:
        info.proposedManagerAddress !== zeroAddress
          ? info.proposedManagerAddress
          : undefined,
      proposedRewardsAddress:
        info.proposedRewardAddress !== zeroAddress
          ? info.proposedRewardAddress
          : undefined,
      extendedManagerPermissions: info.extendedManagerPermissions,
      ownerAddress,
      curveId: curveId.toString(),
      operatorType: resolveOperatorType(ctx.moduleType, curveId),
    };
  });

  const entry = { operators, lastFetchedAt: Date.now() };
  await chrome.storage.local.set({ [storageKey(ctx)]: entry });
  return entry;
}

async function readOperatorBatch(
  client: PublicClient,
  discoveryAddress: Address,
  moduleId: bigint,
  offset: bigint,
) {
  return client.readContract({
    address: discoveryAddress,
    abi: SMDiscoveryAbi,
    functionName: 'getAllNodeOperators',
    args: [moduleId, offset, BATCH_SIZE],
  });
}

export async function getCachedOperators(ctx: CacheContext): Promise<OperatorCacheEntry | null> {
  const key = storageKey(ctx);
  const data = await chrome.storage.local.get(key);
  return (data[key] as OperatorCacheEntry | undefined) ?? null;
}

export function isStale(entry: OperatorCacheEntry): boolean {
  return Date.now() - entry.lastFetchedAt > STALE_MS;
}
