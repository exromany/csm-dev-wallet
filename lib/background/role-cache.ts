import { getAddress, keccak256, toBytes, type Address } from 'viem';
import { MODULE_CONTRACT, type ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
import { BaseModuleAbi } from '@lidofinance/lido-csm-sdk/abi';
import { PROTOCOL_ROLES } from '../shared/modules.js';
import type { CacheContext, CachedRole, ModuleType, RoleCacheEntry } from '../shared/types.js';
import { errorMessage } from '../shared/errors.js';
import { MODULE_NAMES, contractChainId, getClient, moduleContractAddresses } from './client.js';

export function rolesFor(moduleType: ModuleType): ProtocolRole[] {
  return PROTOCOL_ROLES.filter((r) => r.modules.includes(moduleType)).map((r) => r.role);
}

export function rolesStorageKey(ctx: CacheContext): string {
  return `roles_${ctx.moduleType}_${ctx.chainId}`;
}

export async function getCachedRoles(ctx: CacheContext): Promise<RoleCacheEntry | null> {
  const key = rolesStorageKey(ctx);
  const data = await chrome.storage.local.get(key);
  return (data[key] as RoleCacheEntry | undefined) ?? null;
}

/** Never throws — read failures land on the affected roles as `error`. */
export async function fetchRoles(ctx: CacheContext): Promise<RoleCacheEntry> {
  const entry: RoleCacheEntry = { roles: await readRoles(ctx), lastFetchedAt: Date.now() };
  await chrome.storage.local.set({ [rolesStorageKey(ctx)]: entry });
  return entry;
}

async function readRoles(ctx: CacheContext): Promise<CachedRole[]> {
  const name = MODULE_NAMES[ctx.moduleType];
  const address = moduleContractAddresses(ctx.moduleType, contractChainId(ctx))[MODULE_CONTRACT[name]];
  if (!address) return [];

  const roles = rolesFor(ctx.moduleType);
  try {
    const client = getClient(ctx);
    // CuratedModule's SDK ABI lacks the enumerable getters; the contract has them.
    const results = await client.multicall({
      allowFailure: true,
      contracts: roles.map((role) => ({
        address,
        abi: BaseModuleAbi,
        functionName: 'getRoleMembers',
        args: [keccak256(toBytes(role))],
      } as const)),
    });
    const outcomes = results.map((r, i) => {
      const role = roles[i]!;
      return r.status === 'success'
        ? { role, members: r.result.map((a) => getAddress(a)) }
        : { role, members: [], error: errorMessage(r.error) };
    });
    const unique = [...new Set(outcomes.flatMap((o) => o.members))];
    const codes = await Promise.allSettled(unique.map((a) => client.getCode({ address: a })));
    const isContract = new Map<Address, boolean | undefined>(unique.map((a, i) => {
      const c = codes[i]!;
      return [a, c.status === 'fulfilled' ? !!c.value && c.value !== '0x' : undefined];
    }));
    return outcomes.map(({ role, members, error }) => ({
      role,
      holders: members.map((a) => ({ address: a, isContract: isContract.get(a) })),
      ...(error !== undefined && { error }),
    }));
  } catch (err) {
    return roles.map((role) => ({ role, holders: [], error: errorMessage(err) }));
  }
}
