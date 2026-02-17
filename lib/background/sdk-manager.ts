import { LidoSDKCore, CHAINS } from '@lidofinance/lido-ethereum-sdk';
import { LidoSDKCsm, LidoSDKCm } from '@lidofinance/lido-csm-sdk';
import type { ModuleType } from '../shared/types.js';
import type { SupportedChainId } from '../shared/networks.js';
import { DEFAULT_NETWORKS } from '../shared/networks.js';

type ModuleSDKInstance = LidoSDKCsm | LidoSDKCm;

// Cache key: "csm:1" or "cm:17000"
const instances = new Map<string, ModuleSDKInstance>();

function cacheKey(moduleType: ModuleType, chainId: number): string {
  return `${moduleType}:${chainId}`;
}

export function getModuleSDK(
  moduleType: ModuleType,
  chainId: SupportedChainId,
  customRpcUrl?: string,
): ModuleSDKInstance {
  const key = cacheKey(moduleType, chainId);
  const existing = instances.get(key);
  if (existing) return existing;

  const network = DEFAULT_NETWORKS[chainId];
  const rpcUrl = customRpcUrl ?? network.rpcUrl;

  const core = new LidoSDKCore({
    chainId: chainId as CHAINS,
    rpcUrls: [rpcUrl],
    logMode: 'none',
  });

  const sdk = moduleType === 'csm'
    ? new LidoSDKCsm({ core })
    : new LidoSDKCm({ core });

  instances.set(key, sdk);
  return sdk;
}

export function clearSDK(moduleType?: ModuleType, chainId?: SupportedChainId) {
  if (moduleType && chainId) {
    instances.delete(cacheKey(moduleType, chainId));
  } else if (moduleType) {
    for (const key of instances.keys()) {
      if (key.startsWith(`${moduleType}:`)) instances.delete(key);
    }
  } else if (chainId) {
    for (const key of instances.keys()) {
      if (key.endsWith(`:${chainId}`)) instances.delete(key);
    }
  } else {
    instances.clear();
  }
}
