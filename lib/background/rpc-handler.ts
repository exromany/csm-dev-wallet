import type { Address } from 'viem';
import { getSiteState, setSiteState, getGlobalSettings, notifyChainChanged } from './state.js';
import { withImpersonation, getForkedFrom } from './anvil.js';
import { rawJsonRpc } from './rpc.js';
import { errorMessage } from '../shared/errors.js';
import { DEFAULT_NETWORKS, ANVIL_NETWORK, ANVIL_CHAIN_ID, SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../shared/networks.js';

const WATCH_ONLY_ERROR = {
  code: 4200,
  message: 'CSM Dev Wallet: Watch-only address. Signing is only available on Anvil networks.',
};

const NOT_CONNECTED_ERROR = {
  code: 4100,
  message: 'CSM Dev Wallet: No address selected. Open the extension popup to connect.',
};

const BLOCKED_METHODS = /^(anvil_|hardhat_|evm_)/i;

function effectiveChainId(chainId: number, anvilForkedFrom: number | null): number {
  return (chainId === ANVIL_CHAIN_ID && anvilForkedFrom) ? anvilForkedFrom : chainId;
}

export async function handleRpcRequest(
  method: string,
  params: unknown[] | undefined,
  origin: string,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const siteState = await getSiteState(origin);
  const globalSettings = await getGlobalSettings();
  const anvilForkedFrom = await getForkedFrom();

  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts': {
      const accounts = siteState.selectedAddress
        ? [siteState.selectedAddress.address]
        : [];
      return { result: accounts };
    }

    case 'eth_chainId': {
      const id = effectiveChainId(siteState.chainId, anvilForkedFrom);
      return { result: `0x${id.toString(16)}` };
    }

    case 'net_version': {
      const id = effectiveChainId(siteState.chainId, anvilForkedFrom);
      return { result: id.toString() };
    }

    case 'wallet_switchEthereumChain': {
      const switchParam = params?.[0] as { chainId?: string } | undefined;
      if (!switchParam?.chainId) {
        return { error: { code: -32602, message: 'Invalid params' } };
      }
      const requestedChainId = Number(switchParam.chainId);

      const currentEffective = effectiveChainId(siteState.chainId, anvilForkedFrom);
      if (requestedChainId === currentEffective) {
        return { result: null };
      }

      const isSupported =
        (SUPPORTED_CHAIN_IDS as number[]).includes(requestedChainId) ||
        requestedChainId === ANVIL_NETWORK.chainId;
      if (!isSupported) {
        return { error: { code: 4902, message: 'Unrecognized chain ID' } };
      }
      await setSiteState(origin, { chainId: requestedChainId });
      await notifyChainChanged(origin, requestedChainId);
      return { result: null };
    }

    case 'wallet_addEthereumChain': {
      return { error: { code: 4902, message: 'CSM Dev Wallet does not support adding chains' } };
    }

    case 'wallet_requestPermissions': {
      return { result: [{ parentCapability: 'eth_accounts' }] };
    }

    case 'eth_sendTransaction':
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData':
    case 'personal_sign':
    case 'eth_sign': {
      if (!siteState.selectedAddress) {
        return { error: NOT_CONNECTED_ERROR };
      }
      if (siteState.chainId !== ANVIL_CHAIN_ID) {
        return { error: WATCH_ONLY_ERROR };
      }
      const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
      return handleAnvilSigning(method, params, siteState.selectedAddress.address, rpcUrl);
    }

    default: {
      if (BLOCKED_METHODS.test(method)) {
        return { error: { code: 4200, message: `Method ${method} is not available` } };
      }
      return proxyToRpc(method, params, siteState.chainId, globalSettings.customRpcUrls);
    }
  }
}

async function handleAnvilSigning(
  method: string,
  params: unknown[] | undefined,
  address: Address,
  rpcUrl: string,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  try {
    return await withImpersonation(rpcUrl, address, async () => {
      return proxyToRpc(method, params, ANVIL_CHAIN_ID, { [ANVIL_CHAIN_ID]: rpcUrl });
    });
  } catch (err: unknown) {
    return { error: { code: -32000, message: errorMessage(err) || 'Anvil signing failed' } };
  }
}

async function proxyToRpc(
  method: string,
  params: unknown[] | undefined,
  chainId: number,
  customRpcUrls: Partial<Record<number, string>>,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const rpcUrl = customRpcUrls[chainId] ?? getRpcUrl(chainId);

  try {
    const json = await rawJsonRpc(rpcUrl, method, params ?? []);
    if (json.error) {
      return { error: { code: json.error.code, message: json.error.message } };
    }
    return { result: json.result };
  } catch {
    return { error: { code: -32603, message: 'RPC request failed' } };
  }
}

function getRpcUrl(chainId: number): string {
  if (chainId === ANVIL_NETWORK.chainId) return ANVIL_NETWORK.rpcUrl;
  const network = DEFAULT_NETWORKS[chainId as SupportedChainId];
  return network?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl;
}
