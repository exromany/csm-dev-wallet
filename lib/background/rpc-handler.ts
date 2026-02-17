import {
  createWalletClient,
  http,
  type Address,
  type Hex,
  hexToBigInt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, hoodi } from 'viem/chains';
import { getState, setState, notifyChainChanged } from './state.js';
import { getKey } from './key-store.js';
import { DEFAULT_NETWORKS, ANVIL_NETWORK, SUPPORTED_CHAIN_IDS, type SupportedChainId } from '../shared/networks.js';

const UNSUPPORTED_SIGNING_ERROR = {
  code: 4200,
  message: 'CSM Dev Wallet: This is a watch-only address. Signing is not supported unless you import a private key.',
};

const NOT_CONNECTED_ERROR = {
  code: 4100,
  message: 'CSM Dev Wallet: No address selected. Open the extension popup to connect.',
};

export async function handleRpcRequest(
  method: string,
  params?: unknown[],
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const state = await getState();

  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts': {
      const accounts = state.selectedAddress
        ? [state.selectedAddress.address]
        : [];
      return { result: accounts };
    }

    case 'eth_chainId': {
      return { result: `0x${state.chainId.toString(16)}` };
    }

    case 'net_version': {
      return { result: state.chainId.toString() };
    }

    case 'wallet_switchEthereumChain': {
      const switchParam = params?.[0] as { chainId?: string } | undefined;
      if (!switchParam?.chainId) {
        return { error: { code: -32602, message: 'Invalid params' } };
      }
      const requestedChainId = Number(switchParam.chainId);
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
      // QA wallet: reject adding unknown chains
      return { error: { code: 4902, message: 'CSM Dev Wallet does not support adding chains' } };
    }

    case 'wallet_requestPermissions': {
      // Auto-approve — QA wallet has no permission gates
      return { result: [{ parentCapability: 'eth_accounts' }] };
    }

    // Signing methods — block if watch-only
    case 'eth_sendTransaction':
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData':
    case 'personal_sign':
    case 'eth_sign': {
      if (!state.selectedAddress) {
        return { error: NOT_CONNECTED_ERROR };
      }
      if (!state.selectedAddress.canSign) {
        return { error: UNSUPPORTED_SIGNING_ERROR };
      }
      return handleSigning(method, params, state.selectedAddress.address, state.chainId);
    }

    // Everything else — proxy to RPC
    default: {
      return proxyToRpc(method, params, state.chainId, state.customRpcUrls);
    }
  }
}

const INVALID_PARAMS_ERROR = {
  code: -32602,
  message: 'Invalid params',
};

async function handleSigning(
  method: string,
  params: unknown[] | undefined,
  address: Address,
  chainId: number,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  if (!Array.isArray(params) || params.length === 0) {
    return { error: INVALID_PARAMS_ERROR };
  }

  const key = await getKey(address);
  if (!key) {
    return { error: UNSUPPORTED_SIGNING_ERROR };
  }

  try {
    const account = privateKeyToAccount(key as Hex);
    const chain = getChainForId(chainId);
    const rpcUrl = getRpcUrl(chainId);

    const client = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    switch (method) {
      case 'personal_sign': {
        if (params.length < 2) return { error: INVALID_PARAMS_ERROR };
        // personal_sign(data, address)
        const [message] = params as [Hex, Address];
        const signature = await client.signMessage({
          message: { raw: message },
        });
        return { result: signature };
      }

      case 'eth_sign': {
        if (params.length < 2) return { error: INVALID_PARAMS_ERROR };
        // eth_sign(address, data) — reversed vs personal_sign
        const [, message] = params as [Address, Hex];
        const signature = await client.signMessage({
          message: { raw: message },
        });
        return { result: signature };
      }

      case 'eth_signTypedData_v4':
      case 'eth_signTypedData': {
        if (params.length < 2) return { error: INVALID_PARAMS_ERROR };
        const [, typedDataJson] = params as [Address, string];
        let typedData: unknown;
        try {
          typedData = typeof typedDataJson === 'string'
            ? JSON.parse(typedDataJson)
            : typedDataJson;
        } catch {
          return { error: { code: -32602, message: 'Invalid typed data JSON' } };
        }
        const signature = await client.signTypedData(typedData as any);
        return { result: signature };
      }

      case 'eth_sendTransaction': {
        const [txParams] = params as [Record<string, any>];
        if (!txParams || typeof txParams !== 'object') {
          return { error: INVALID_PARAMS_ERROR };
        }
        const hash = await client.sendTransaction({
          to: txParams.to as Address,
          data: txParams.data as Hex | undefined,
          value: txParams.value ? hexToBigInt(txParams.value) : undefined,
          gas: txParams.gas ? hexToBigInt(txParams.gas) : undefined,
        });
        return { result: hash };
      }

      default:
        return { error: { code: 4200, message: `Unsupported method: ${method}` } };
    }
  } catch (err: any) {
    return { error: { code: -32000, message: err.message ?? 'Signing failed' } };
  }
}

async function proxyToRpc(
  method: string,
  params: unknown[] | undefined,
  chainId: number,
  customRpcUrls: Partial<Record<number, string>>,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  const rpcUrl = customRpcUrls[chainId as SupportedChainId] ?? getRpcUrl(chainId);

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: params ?? [],
      }),
    });
    const json = await res.json();

    if (json.error) {
      const error: { code: number; message: string; data?: unknown } = {
        code: json.error.code,
        message: json.error.message,
      };
      if (json.error.data !== undefined) error.data = json.error.data;
      return { error };
    }
    return { result: json.result };
  } catch (err: any) {
    return { error: { code: -32603, message: `RPC error: ${err.message}` } };
  }
}

function getRpcUrl(chainId: number): string {
  if (chainId === ANVIL_NETWORK.chainId) return ANVIL_NETWORK.rpcUrl;
  const network = DEFAULT_NETWORKS[chainId as SupportedChainId];
  return network?.rpcUrl ?? DEFAULT_NETWORKS[1 as SupportedChainId].rpcUrl;
}

function getChainForId(chainId: number) {
  if (chainId === 1) return mainnet;
  if (chainId === 17000) return hoodi;
  // For Anvil / unknown, use mainnet as base
  return mainnet;
}
