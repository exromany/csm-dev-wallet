import {
  setSiteState,
  getSiteState,
  getComposedState,
  getGlobalSettings,
  setGlobalSettings,
  notifyAccountsChanged,
  notifyChainChanged,
} from './state.js';
import { clearClientCache, fetchOperators } from './operator-cache.js';
import { DEFAULT_NETWORKS, ANVIL_NETWORK, ANVIL_CHAIN_ID } from '../shared/networks.js';
import type { SupportedChainId } from '../shared/networks.js';
import type { AddressSource, AddressRole } from '../shared/types.js';
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

const ADDRESS_ROLES: AddressRole[] = ['manager', 'rewards', 'proposedManager', 'proposedRewards'];

const ROLE_FIELDS: Record<AddressRole, string> = {
  manager: 'managerAddress',
  rewards: 'rewardsAddress',
  proposedManager: 'proposedManagerAddress',
  proposedRewards: 'proposedRewardsAddress',
};

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

    case 'wallet_testRefreshOperators': {
      const p = (params?.[0] ?? {}) as {
        chainId?: number;
        moduleType?: string;
        rpcUrl?: string;
      };
      const [site, settings] = await Promise.all([getSiteState(origin), getGlobalSettings()]);
      const chainId = p.chainId ?? site.chainId;
      const moduleType = p.moduleType ?? site.moduleType;
      let rpcUrl = p.rpcUrl;
      if (!rpcUrl) {
        rpcUrl = settings.customRpcUrls[chainId];
      }
      if (!rpcUrl) {
        const isAnvil = chainId === ANVIL_CHAIN_ID;
        rpcUrl = isAnvil
          ? ANVIL_NETWORK.rpcUrl
          : DEFAULT_NETWORKS[chainId as SupportedChainId]?.rpcUrl ?? ANVIL_NETWORK.rpcUrl;
      }
      const entry = await fetchOperators({ chainId, moduleType: moduleType as any, rpcUrl });
      return { result: entry.operators };
    }

    case 'wallet_testSetRpcUrl': {
      const p = (params?.[0] ?? {}) as { chainId?: number; rpcUrl?: string };
      if (p.chainId === undefined || p.chainId === null) {
        return { error: { code: -32602, message: 'Missing chainId parameter' } };
      }
      if (!p.rpcUrl) {
        return { error: { code: -32602, message: 'Missing rpcUrl parameter' } };
      }
      const settings = await getGlobalSettings();
      await setGlobalSettings({
        customRpcUrls: { ...settings.customRpcUrls, [p.chainId]: p.rpcUrl },
      });
      clearClientCache();
      return { result: null };
    }

    case 'wallet_testSetOperatorAccount': {
      const p = (params?.[0] ?? {}) as {
        operatorId?: string;
        role?: unknown;
        chainId?: number;
        moduleType?: string;
      };
      if (!p.operatorId) {
        return { error: { code: -32602, message: 'Missing operatorId parameter' } };
      }
      if (!p.role || !ADDRESS_ROLES.includes(p.role as AddressRole)) {
        return {
          error: {
            code: -32602,
            message: `Missing or invalid role. Must be one of: ${ADDRESS_ROLES.join(', ')}`,
          },
        };
      }
      const role = p.role as AddressRole;
      const site = await getSiteState(origin);
      const chainId = p.chainId ?? site.chainId;
      const moduleType = p.moduleType ?? site.moduleType;
      const key = `operators_${moduleType}_${chainId}`;
      const data = await chrome.storage.local.get(key);
      const entry = data[key] as { operators: Array<Record<string, Address | undefined>> } | undefined;
      const operator = entry?.operators.find((op) => op['id'] === p.operatorId);
      if (!operator) {
        return { error: { code: -32601, message: `Operator ${p.operatorId} not found` } };
      }
      const field = ROLE_FIELDS[role];
      const address = operator[field];
      if (!address) {
        return {
          error: { code: -32602, message: `Operator ${p.operatorId} has no address for role "${role}"` },
        };
      }
      await setSiteState(origin, {
        selectedAddress: {
          address,
          source: { type: 'operator', operatorId: p.operatorId, role },
        },
        isConnected: true,
      });
      await notifyAccountsChanged(origin, [address]);
      return { result: null };
    }

    case 'wallet_testGetOperator': {
      const p = (params?.[0] ?? {}) as {
        operatorId?: string;
        chainId?: number;
        moduleType?: string;
      };
      if (!p.operatorId) {
        return { error: { code: -32602, message: 'Missing operatorId parameter' } };
      }
      const site = await getSiteState(origin);
      const chainId = p.chainId ?? site.chainId;
      const moduleType = p.moduleType ?? site.moduleType;
      const key = `operators_${moduleType}_${chainId}`;
      const data = await chrome.storage.local.get(key);
      const entry = data[key] as { operators: Array<{ id: string }> } | undefined;
      if (!entry) {
        return { error: { code: -32601, message: `Operator ${p.operatorId} not found` } };
      }
      const operator = entry.operators.find((op) => op.id === p.operatorId);
      if (!operator) {
        return { error: { code: -32601, message: `Operator ${p.operatorId} not found` } };
      }
      return { result: operator };
    }

    case 'wallet_testGetOperators': {
      const p = (params?.[0] ?? {}) as { chainId?: number; moduleType?: string };
      const site = await getSiteState(origin);
      const chainId = p.chainId ?? site.chainId;
      const moduleType = p.moduleType ?? site.moduleType;
      const key = `operators_${moduleType}_${chainId}`;
      const data = await chrome.storage.local.get(key);
      const entry = data[key] as { operators: unknown[] } | undefined;
      return { result: entry?.operators ?? null };
    }

    default:
      return NOT_HANDLED;
  }
}
