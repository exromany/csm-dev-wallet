import { CSM_CONTRACT_ADDRESSES } from '@lidofinance/lido-csm-sdk/common';
import type { Address } from 'viem';
import { CHAIN_ID, type SupportedChainId } from '../shared/networks.js';

/** Detect which chain an Anvil fork is based on by probing CSM contracts */
export async function detectAnvilFork(
  rpcUrl: string,
): Promise<SupportedChainId | null> {
  try {
    const chainIdHex = await jsonRpc(rpcUrl, 'eth_chainId');
    const chainId = parseInt(chainIdHex, 16);

    // If not Anvil's default chain ID, it's not a local fork
    if (chainId !== 31337) return null;

    // Probe mainnet CSM module contract
    const mainnetCsm = CSM_CONTRACT_ADDRESSES[CHAIN_ID.Mainnet].csModule;
    if (mainnetCsm && (await hasCode(rpcUrl, mainnetCsm))) {
      return CHAIN_ID.Mainnet;
    }

    // Probe Hoodi CSM module contract
    const hoodiCsm = CSM_CONTRACT_ADDRESSES[CHAIN_ID.Hoodi].csModule;
    if (hoodiCsm && (await hasCode(rpcUrl, hoodiCsm))) {
      return CHAIN_ID.Hoodi;
    }

    return null;
  } catch {
    return null;
  }
}

/** Get Anvil's pre-funded accounts */
export async function getAnvilAccounts(rpcUrl: string): Promise<Address[]> {
  try {
    return await jsonRpc(rpcUrl, 'eth_accounts');
  } catch {
    return [];
  }
}

async function hasCode(rpcUrl: string, address: Address): Promise<boolean> {
  const code = await jsonRpc(rpcUrl, 'eth_getCode', [address, 'latest']);
  return code !== '0x' && code !== '0x0';
}

/** Impersonate an account on Anvil, execute fn, then stop impersonating */
export async function withImpersonation<T>(
  rpcUrl: string,
  address: Address,
  fn: () => Promise<T>,
): Promise<T> {
  await jsonRpc(rpcUrl, 'anvil_impersonateAccount', [address]);
  try {
    return await fn();
  } finally {
    await jsonRpc(rpcUrl, 'anvil_stopImpersonatingAccount', [address]).catch(() => {});
  }
}

export async function jsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}
