import type { SupportedChainId } from '../shared/networks.js';
import type { CachedOperator, ModuleType, OperatorCacheEntry } from '../shared/types.js';
import { getModuleSDK } from './sdk-manager.js';
import { zeroAddress } from 'viem';

const STALE_MS = 30 * 60 * 1000; // 30 minutes

function storageKey(moduleType: ModuleType, chainId: number): string {
  return `operators_${moduleType}_${chainId}`;
}

export async function fetchAllOperators(
  moduleType: ModuleType,
  chainId: SupportedChainId,
  customRpcUrl?: string,
): Promise<OperatorCacheEntry> {
  const sdk = getModuleSDK(moduleType, chainId, customRpcUrl);

  try {
    const raw = await sdk.discovery.getAllNodeOperators();

    const operators: CachedOperator[] = raw.map((info) => {
      const ownerAddress = info.extendedManagerPermissions
        ? info.managerAddress
        : info.rewardAddress;

      return {
        id: info.id.toString(),
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
        curveId: info.curveId.toString(),
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
