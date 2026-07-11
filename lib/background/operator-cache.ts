import { createPublicClient, http, zeroAddress, type Address, type PublicClient, type Chain } from 'viem';
import {
  COMMON_ADDRESSES,
  MODULE_CONFIG,
  MODULE_NAME,
  getOperatorTypeByCurveId,
} from '@lidofinance/lido-csm-sdk/common';
import { SMDiscoveryAbi, CuratedModuleAbi, MetaRegistryAbi } from '@lidofinance/lido-csm-sdk/abi';
import { DEFAULT_NETWORKS, type SupportedChainId } from '../shared/networks.js';
import type { CachedOperator, CacheContext, ModuleType, OperatorCacheEntry } from '../shared/types.js';

const STALE_MS = 30 * 60 * 1000; // 30 minutes
const AVAILABILITY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 500n;

const MODULE_NAMES: Record<ModuleType, MODULE_NAME> = {
  csm: MODULE_NAME.CSM,
  cm: MODULE_NAME.CM,
};

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

// Curve IDs overlap between CSM_* and CM_* entries — must scope by module/chain.
// Anything outside the module's known curves is treated as Community Curve (unknown to widget).
function resolveOperatorType(
  chainId: SupportedChainId,
  moduleType: ModuleType,
  curveId: bigint,
): string {
  return getOperatorTypeByCurveId(chainId, MODULE_NAMES[moduleType], curveId) ?? 'CC';
}

export function storageKey(ctx: CacheContext): string {
  return `operators_${ctx.moduleType}_${ctx.chainId}`;
}

function getDiscoveryAddress(chainId: SupportedChainId): Address {
  const addresses = COMMON_ADDRESSES[chainId as keyof typeof COMMON_ADDRESSES];
  const addr = addresses?.smDiscovery;
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
    const moduleId = MODULE_CONFIG[MODULE_NAMES[ctx.moduleType]][ccid].moduleId;
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
  const moduleId = MODULE_CONFIG[MODULE_NAMES[ctx.moduleType]][ccid].moduleId;

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
      operatorType: resolveOperatorType(ccid, ctx.moduleType, curveId),
    };
  });

  if (ctx.moduleType === 'cm' && operators.length > 0) {
    await enrichWithGroups(client, discoveryAddress, moduleId, operators);
  }

  const entry = { operators, lastFetchedAt: Date.now() };
  await chrome.storage.local.set({ [storageKey(ctx)]: entry });
  return entry;
}

/**
 * CM-only: decorate operators in-place with `groupId` + optional `groupName`
 * sourced from on-chain MetaRegistry.
 *
 * Flow: SMDiscovery.moduleCache(moduleId) → CuratedModule address →
 * CuratedModule.META_REGISTRY() → MetaRegistry. Per operator:
 * getNodeOperatorGroupId(opId). Per unique non-zero groupId: getOperatorGroup
 * for the title.
 *
 * Failure-tolerant: a missing MetaRegistry or transient RPC error leaves
 * operators ungrouped — the rest of the cache stays usable.
 */
async function enrichWithGroups(
  client: PublicClient,
  discoveryAddress: Address,
  moduleId: bigint,
  operators: CachedOperator[],
): Promise<void> {
  try {
    const [moduleAddress] = await client.readContract({
      address: discoveryAddress,
      abi: SMDiscoveryAbi,
      functionName: 'moduleCache',
      args: [moduleId],
    });
    if (moduleAddress === zeroAddress) return;

    const metaRegistry = await client.readContract({
      address: moduleAddress,
      abi: CuratedModuleAbi,
      functionName: 'META_REGISTRY',
    });
    if (!metaRegistry || metaRegistry === zeroAddress) return;

    const groupIds = await Promise.all(
      operators.map((op) =>
        client.readContract({
          address: metaRegistry,
          abi: MetaRegistryAbi,
          functionName: 'getNodeOperatorGroupId',
          args: [BigInt(op.id)],
        }),
      ),
    );

    // groupId === 0n means "no group"
    const uniqueGroupIds = [...new Set(groupIds.filter((id) => id !== 0n))];
    const groupInfos = await Promise.all(
      uniqueGroupIds.map((gid) =>
        client
          .readContract({
            address: metaRegistry,
            abi: MetaRegistryAbi,
            functionName: 'getOperatorGroup',
            args: [gid],
          })
          .then((info) => ({ gid, info }))
          .catch(() => ({ gid, info: null })),
      ),
    );
    const nameByGroup = new Map<string, string>();
    for (const { gid, info } of groupInfos) {
      if (info && info.name && info.name.length > 0) {
        nameByGroup.set(gid.toString(), info.name);
      }
    }

    for (let i = 0; i < operators.length; i++) {
      const gid = groupIds[i];
      if (gid === 0n) continue;
      const op = operators[i];
      op.groupId = gid.toString();
      const name = nameByGroup.get(op.groupId);
      if (name) op.groupName = name;
    }
  } catch {
    // Group enrichment is best-effort — failure leaves operators ungrouped.
  }
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
