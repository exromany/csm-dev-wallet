import { setSiteState, getComposedState, notifyAccountsChanged, notifyChainChanged } from './state.js';
import type { AddressSource } from '../shared/types.js';
import type { Address } from 'viem';

export const NOT_HANDLED: unique symbol = Symbol('NOT_HANDLED');

export type SigningMode = 'approve' | 'reject' | 'error' | 'prompt';

const SIGNING_MODES: SigningMode[] = ['approve', 'reject', 'error', 'prompt'];

let signingMode: SigningMode = 'prompt';

export function getSigningMode(): SigningMode {
  // Allow setting from sw.evaluate() during Playwright setup (before any page exists)
  if (typeof self !== 'undefined' && (self as any).__testSigningMode) {
    const external = (self as any).__testSigningMode as string;
    if (SIGNING_MODES.includes(external as SigningMode)) return external as SigningMode;
  }
  return signingMode;
}

export function setSigningMode(mode: SigningMode): void {
  signingMode = mode;
  // Clear the external override so RPC-set values take precedence
  if (typeof self !== 'undefined') {
    (self as any).__testSigningMode = undefined;
  }
}

export type TestRpcResult =
  | { result: unknown; error?: never }
  | { error: { code: number; message: string }; result?: never }
  | typeof NOT_HANDLED;

export async function handleTestRpc(
  origin: string,
  method: string,
  params?: unknown[],
): Promise<TestRpcResult> {
  switch (method) {
    case 'wallet_testGetState': {
      const state = await getComposedState(origin);
      return { result: state };
    }

    case 'wallet_testConnect': {
      const p = (params?.[0] ?? {}) as { address?: Address; source?: AddressSource };
      if (p.address) {
        await setSiteState(origin, {
          selectedAddress: { address: p.address, source: p.source ?? { type: 'manual' } },
          isConnected: true,
        });
        await notifyAccountsChanged(origin, [p.address]);
      } else {
        await setSiteState(origin, { isConnected: true });
      }
      return { result: null };
    }

    case 'wallet_testDisconnect': {
      await setSiteState(origin, { selectedAddress: null, isConnected: false });
      await notifyAccountsChanged(origin, []);
      return { result: null };
    }

    case 'wallet_testSetAccount': {
      const p = (params?.[0] ?? {}) as { address: Address; source?: AddressSource };
      if (!p.address) {
        return { error: { code: -32602, message: 'Missing address parameter' } };
      }
      await setSiteState(origin, {
        selectedAddress: { address: p.address, source: p.source ?? { type: 'manual' } },
        isConnected: true,
      });
      await notifyAccountsChanged(origin, [p.address]);
      return { result: null };
    }

    case 'wallet_testSetNetwork': {
      const p = (params?.[0] ?? {}) as { chainId: number };
      await setSiteState(origin, { chainId: p.chainId });
      await notifyChainChanged(origin, p.chainId);
      return { result: null };
    }

    case 'wallet_testSetSigningMode': {
      const p = (params?.[0] ?? {}) as { mode: unknown };
      if (!SIGNING_MODES.includes(p.mode as SigningMode)) {
        return {
          error: {
            code: -32602,
            message: `Invalid signing mode: "${p.mode}". Must be one of: ${SIGNING_MODES.join(', ')}`,
          },
        };
      }
      signingMode = p.mode as SigningMode;
      return { result: null };
    }

    case 'wallet_testSeedOperators': {
      const p = (params?.[0] ?? {}) as {
        operators: unknown[];
        chainId: number;
        moduleType: string;
      };
      const key = `operators_${p.moduleType}_${p.chainId}`;
      await chrome.storage.local.set({
        [key]: { operators: p.operators, lastFetchedAt: Date.now() },
      });
      return { result: null };
    }

    default:
      return NOT_HANDLED;
  }
}
