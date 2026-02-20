import { CSM_CONTRACT_ADDRESSES } from '@lidofinance/lido-csm-sdk/common';
import type { Address } from 'viem';
import { CHAIN_ID, SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../shared/networks.js';
import { rawJsonRpc } from './rpc.js';

// ── Anvil fork state ──
// In-memory cache; restored from chrome.storage.session on cold start
let anvilForkedFrom: SupportedChainId | null = null;

export async function getForkedFrom(): Promise<SupportedChainId | null> {
  if (anvilForkedFrom !== null) return anvilForkedFrom;
  const data = await chrome.storage.session.get('anvilForkedFrom');
  anvilForkedFrom = (data.anvilForkedFrom as SupportedChainId) ?? null;
  return anvilForkedFrom;
}

export async function setForkedFrom(chainId: SupportedChainId): Promise<void> {
  anvilForkedFrom = chainId;
  await chrome.storage.session.set({ anvilForkedFrom: chainId });
}

export async function clearForkedFrom(): Promise<void> {
  anvilForkedFrom = null;
  await chrome.storage.session.remove('anvilForkedFrom');
}

/** Detect which chain an Anvil fork is based on via anvil_nodeInfo */
export async function detectAnvilFork(
  rpcUrl: string,
): Promise<SupportedChainId | null> {
  try {
    // anvil_nodeInfo is Anvil-specific — errors on real nodes
    const { result: nodeInfo, error } = await rawJsonRpc(rpcUrl, 'anvil_nodeInfo');
    if (error || !nodeInfo) return null;

    const info = nodeInfo as { environment?: { chainId?: number } };
    const chainId = info.environment?.chainId;

    // Anvil preserving forked chain's ID (e.g. 1 or 560048)
    if (typeof chainId === 'number' && SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)) {
      return chainId as SupportedChainId;
    }

    // Explicit --chain-id 31337 override — fall back to contract probing
    if (chainId === 31337) {
      return await probeContracts(rpcUrl);
    }

    return null;
  } catch {
    return null;
  }
}

/** Probe CSM contracts to determine which chain was forked */
async function probeContracts(rpcUrl: string): Promise<SupportedChainId | null> {
  const mainnetCsm = CSM_CONTRACT_ADDRESSES[CHAIN_ID.Mainnet].csModule;
  if (mainnetCsm && (await hasCode(rpcUrl, mainnetCsm))) return CHAIN_ID.Mainnet;

  const hoodiCsm = CSM_CONTRACT_ADDRESSES[CHAIN_ID.Hoodi].csModule;
  if (hoodiCsm && (await hasCode(rpcUrl, hoodiCsm))) return CHAIN_ID.Hoodi;

  return null;
}

/** Get Anvil's pre-funded accounts */
export async function getAnvilAccounts(rpcUrl: string): Promise<Address[]> {
  try {
    const { result } = await rawJsonRpc(rpcUrl, 'eth_accounts');
    return (result as Address[]) ?? [];
  } catch {
    return [];
  }
}

async function hasCode(rpcUrl: string, address: Address): Promise<boolean> {
  const { result: code } = await rawJsonRpc(rpcUrl, 'eth_getCode', [address, 'latest']);
  return code !== '0x' && code !== '0x0';
}

/** Impersonate an account on Anvil, execute fn, then stop impersonating */
export async function withImpersonation<T>(
  rpcUrl: string,
  address: Address,
  fn: () => Promise<T>,
): Promise<T> {
  const imp = await rawJsonRpc(rpcUrl, 'anvil_impersonateAccount', [address]);
  if (imp.error) throw new Error(imp.error.message);
  try {
    return await fn();
  } finally {
    await rawJsonRpc(rpcUrl, 'anvil_stopImpersonatingAccount', [address]).catch(() => {});
  }
}
