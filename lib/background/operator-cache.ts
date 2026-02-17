import { createPublicClient, http, zeroAddress, type Address } from 'viem';
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
import type { CachedOperator, ModuleType, OperatorCacheEntry } from '../shared/types.js';

const STALE_MS = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE = 500n;

const MODULE_IDS: Record<ModuleType, Record<SupportedChainId, number>> = {
  csm: CSM_MODULE_IDS as Record<SupportedChainId, number>,
  cm: CM_MODULE_IDS as Record<SupportedChainId, number>,
};

const CURVE_ID_MAPS = {
  csm: CSM_OPERATOR_TYPE_CURVE_ID,
  cm: CM_OPERATOR_TYPE_CURVE_ID,
} as const;

function resolveOperatorType(moduleType: ModuleType, curveId: bigint): OperatorType {
  const mapping = CURVE_ID_MAPS[moduleType];
  const entry = Object.entries(mapping).find(([, id]) => id === curveId);
  return (entry?.[0] ?? 'CC') as OperatorType;
}

function storageKey(moduleType: ModuleType, chainId: number): string {
  return `operators_${moduleType}_${chainId}`;
}

function getDiscoveryAddress(chainId: SupportedChainId): Address {
  const addresses = COMMON_CONTRACT_ADDRESSES[chainId as keyof typeof COMMON_CONTRACT_ADDRESSES];
  const addr = addresses?.SMDiscovery;
  if (!addr) throw new Error(`No SMDiscovery address for chain ${chainId}`);
  return addr;
}

export async function fetchAllOperators(
  moduleType: ModuleType,
  chainId: SupportedChainId,
  customRpcUrl?: string,
): Promise<OperatorCacheEntry> {
  const network = DEFAULT_NETWORKS[chainId];
  const rpcUrl = customRpcUrl ?? network.rpcUrl;

  const client = createPublicClient({
    chain: network.viemChain,
    transport: http(rpcUrl),
  });

  const discoveryAddress = getDiscoveryAddress(chainId);
  const moduleId = BigInt(MODULE_IDS[moduleType][chainId]);

  try {
    // Paginate through all operators
    const allRaw: any[] = [];
    let offset = 0n;

    while (true) {
      const batch = await client.readContract({
        address: discoveryAddress,
        abi: SMDiscoveryAbi,
        functionName: 'getAllNodeOperators',
        args: [moduleId, offset, BATCH_SIZE],
      });

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

    const entry: OperatorCacheEntry = {
      operators,
      lastFetchedAt: Date.now(),
    };

    await chrome.storage.local.set({ [storageKey(moduleType, chainId)]: entry });
    return entry;
  } catch (err) {
    // CM may not be deployed on all networks — return empty
    const entry: OperatorCacheEntry = { operators: [], lastFetchedAt: Date.now() };
    await chrome.storage.local.set({ [storageKey(moduleType, chainId)]: entry });
    throw err;
  }
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
