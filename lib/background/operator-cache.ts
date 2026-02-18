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
import { DEFAULT_NETWORKS, ANVIL_CHAIN_ID, type SupportedChainId } from '../shared/networks.js';
import type { CachedOperator, ModuleType, OperatorCacheEntry } from '../shared/types.js';

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

// ── Client cache ──

const clientCache = new Map<string, PublicClient>();

function getClient(chainId: SupportedChainId, customRpcUrl?: string): PublicClient {
  const network = DEFAULT_NETWORKS[chainId];
  const rpcUrl = customRpcUrl ?? network.rpcUrl;
  const key = `${chainId}:${rpcUrl}`;

  let client = clientCache.get(key);
  if (!client) {
    client = createPublicClient({
      chain: network.viemChain as Chain,
      transport: http(rpcUrl, {
        timeout: customRpcUrl ? 120_000 : 10_000,
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

export function storageKey(moduleType: ModuleType, chainId: number): string {
  return `operators_${moduleType}_${chainId}`;
}

function getDiscoveryAddress(chainId: SupportedChainId): Address {
  const addresses = COMMON_CONTRACT_ADDRESSES[chainId as keyof typeof COMMON_CONTRACT_ADDRESSES];
  const addr = addresses?.SMDiscovery;
  if (!addr) throw new Error(`No SMDiscovery address for chain ${chainId}`);
  return addr;
}

export async function isModuleAvailable(
  moduleType: ModuleType,
  chainId: SupportedChainId,
  customRpcUrl?: string,
): Promise<boolean> {
  const key = `${moduleType}:${chainId}`;
  const hit = availabilityCache.get(key);
  if (hit && Date.now() - hit.checkedAt < AVAILABILITY_TTL_MS) return hit.available;

  // Check persistent cache — if already confirmed available, skip RPC
  const persisted = await getModuleAvailabilityCache(chainId);
  if (persisted && moduleType === 'cm' && persisted.cm) {
    availabilityCache.set(key, { available: true, checkedAt: Date.now() });
    return true;
  }

  const client = getClient(chainId, customRpcUrl);

  try {
    const discoveryAddress = getDiscoveryAddress(chainId);
    const moduleId = BigInt(MODULE_IDS[moduleType][chainId]);
    const [moduleAddress] = await client.readContract({
      address: discoveryAddress,
      abi: SMDiscoveryAbi,
      functionName: 'moduleCache',
      args: [moduleId],
    });
    const available = moduleAddress !== zeroAddress;
    availabilityCache.set(key, { available, checkedAt: Date.now() });
    return available;
  } catch {
    availabilityCache.set(key, { available: false, checkedAt: Date.now() });
    return false;
  }
}

async function doFetchOperators(
  moduleType: ModuleType,
  chainId: SupportedChainId,
  customRpcUrl?: string,
): Promise<OperatorCacheEntry> {
  const client = getClient(chainId, customRpcUrl);
  const discoveryAddress = getDiscoveryAddress(chainId);
  const moduleId = BigInt(MODULE_IDS[moduleType][chainId]);

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
      operatorType: resolveOperatorType(moduleType, curveId),
    };
  });

  return { operators, lastFetchedAt: Date.now() };
}

export async function fetchAllOperators(
  moduleType: ModuleType,
  chainId: SupportedChainId,
  customRpcUrl?: string,
): Promise<OperatorCacheEntry> {
  const entry = await doFetchOperators(moduleType, chainId, customRpcUrl);
  await chrome.storage.local.set({ [storageKey(moduleType, chainId)]: entry });
  return entry;
}

/** Fetch operators from Anvil using forked chain's contracts, cache under Anvil key only */
export async function fetchAnvilOperators(
  moduleType: ModuleType,
  forkedFrom: SupportedChainId,
  anvilRpcUrl: string,
): Promise<OperatorCacheEntry> {
  const entry = await doFetchOperators(moduleType, forkedFrom, anvilRpcUrl);
  await chrome.storage.local.set({ [storageKey(moduleType, ANVIL_CHAIN_ID)]: entry });
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

export async function getCachedOperators(
  moduleType: ModuleType,
  chainId: number,
): Promise<OperatorCacheEntry | null> {
  const key = storageKey(moduleType, chainId);
  const data = await chrome.storage.local.get(key);
  return (data[key] as OperatorCacheEntry | undefined) ?? null;
}

export function isStale(entry: OperatorCacheEntry): boolean {
  return Date.now() - entry.lastFetchedAt > STALE_MS;
}
