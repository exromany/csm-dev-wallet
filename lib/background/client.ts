import { createPublicClient, http, type PublicClient, type Chain } from 'viem';
import { MODULE_NAME } from '@lidofinance/lido-csm-sdk/common';
import { DEFAULT_NETWORKS, type SupportedChainId } from '../shared/networks.js';
import type { CacheContext, ModuleType } from '../shared/types.js';

export const STALE_MS = 30 * 60 * 1000; // 30 minutes

export const MODULE_NAMES: Record<ModuleType, MODULE_NAME> = {
  csm: MODULE_NAME.CSM,
  cm: MODULE_NAME.CM,
  csm02: MODULE_NAME.CSM_02,
};

/** The chain whose contracts/ABIs to use — forkedFrom for Anvil, chainId otherwise */
export function contractChainId(ctx: CacheContext): SupportedChainId {
  return (ctx.forkedFrom ?? ctx.chainId) as SupportedChainId;
}

// ── Client cache ──

const clientCache = new Map<string, PublicClient>();

export function getClient(ctx: CacheContext): PublicClient {
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

export function isStale(entry: { lastFetchedAt: number }): boolean {
  return Date.now() - entry.lastFetchedAt > STALE_MS;
}
