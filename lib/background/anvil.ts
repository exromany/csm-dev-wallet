import { CSM_CONTRACT_ADDRESSES } from '@lidofinance/lido-csm-sdk/common';
import type { Address } from 'viem';
import { CHAIN_ID, type SupportedChainId } from '../shared/networks.js';
import { rawJsonRpc } from './rpc.js';

/** Detect which chain an Anvil fork is based on by probing CSM contracts */
export async function detectAnvilFork(
  rpcUrl: string,
): Promise<SupportedChainId | null> {
  try {
    const { result: chainIdHex } = await rawJsonRpc(rpcUrl, 'eth_chainId');
    const chainId = parseInt(chainIdHex as string, 16);

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
