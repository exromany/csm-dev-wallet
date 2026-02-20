import type { Address } from 'viem';
import { getState, setState, notifyChainChanged } from './state.js';
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
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const state = await getState();
  const anvilForkedFrom = await getForkedFrom();

  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts': {
      const accounts = state.selectedAddress
        ? [state.selectedAddress.address]
        : [];
      return { result: accounts };
    }

    case 'eth_chainId': {
      const id = effectiveChainId(state.chainId, anvilForkedFrom);
      return { result: `0x${id.toString(16)}` };
    }

    case 'net_version': {
      const id = effectiveChainId(state.chainId, anvilForkedFrom);
      return { result: id.toString() };
    }

    case 'wallet_switchEthereumChain': {
      const switchParam = params?.[0] as { chainId?: string } | undefined;
      if (!switchParam?.chainId) {
        return { error: { code: -32602, message: 'Invalid params' } };
      }
      const requestedChainId = Number(switchParam.chainId);

      // Already on the requested chain (including spoofed Anvil)
      const currentEffective = effectiveChainId(state.chainId, anvilForkedFrom);
      if (requestedChainId === currentEffective) {
        return { result: null };
      }

      const isSupported =
        (SUPPORTED_CHAIN_IDS as number[]).includes(requestedChainId) ||
        requestedChainId === ANVIL_NETWORK.chainId;
      if (!isSupported) {
        return { error: { code: 4902, message: 'Unrecognized chain ID' } };
      }
      await setState({ chainId: requestedChainId });
      await notifyChainChanged(requestedChainId);
      return { result: null };
    }

    case 'wallet_addEthereumChain': {
      return { error: { code: 4902, message: 'CSM Dev Wallet does not support adding chains' } };
    }

    case 'wallet_requestPermissions': {
      return { result: [{ parentCapability: 'eth_accounts' }] };
    }

    // Signing methods — Anvil impersonation or watch-only error
    case 'eth_sendTransaction':
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData':
    case 'personal_sign':
    case 'eth_sign': {
      if (!state.selectedAddress) {
        return { error: NOT_CONNECTED_ERROR };
      }
      if (state.chainId !== ANVIL_CHAIN_ID) {
        return { error: WATCH_ONLY_ERROR };
      }
      const rpcUrl = state.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
      return handleAnvilSigning(method, params, state.selectedAddress.address, rpcUrl);
    }

    // Everything else — proxy to RPC (block dangerous methods)
    default: {
      if (BLOCKED_METHODS.test(method)) {
        return { error: { code: 4200, message: `Method ${method} is not available` } };
      }
      return proxyToRpc(method, params, state.chainId, state.customRpcUrls);
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
