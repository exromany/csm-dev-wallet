# Protocol Roles Tab Implementation Plan

> **For agentic workers:** Implement task-by-task, in order. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bump lido-csm-sdk to 3.0.0 and add a Roles tab listing holders of the SDK's protocol roles, selectable as the connected address.

**Architecture:** A new service-worker cache (`role-cache.ts`) mirrors `gate-cache.ts`: one multicall of `getRoleMembers` per module contract, `getCode` per holder, stored in `chrome.storage.local`, refreshed through the same `refreshCached` helper. The popup requests every available module (like the Shared tab), groups results by role, and renders them in `RoleHolders.tsx`.

**Tech Stack:** WXT, React, viem, `@lidofinance/lido-csm-sdk` (ABI + constants + `ProtocolRole` type), vitest, raw Playwright e2e.

> **Superseded:** the popup later narrowed to the current module only (no cross-module grouping, module tag or module switch on select). See the spec's Popup section.

**Spec:** `docs/brainstorms/2026-10-22-protocol-roles-tab.md`

## Global Constraints

- `.js` extensions in TS imports. SDK constants from `@lidofinance/lido-csm-sdk/common`, ABIs from `@lidofinance/lido-csm-sdk/abi`.
- Roles = SDK `ProtocolRole` only: `REPORT_GENERAL_DELAYED_PENALTY_ROLE` (every module), `ENABLE_TOP_UP_ALLOCATION_ROLE` (CM only).
- Role id = `keccak256(toBytes(role))`; read with `BaseModuleAbi` `getRoleMembers` against `MODULE_CONFIG[name][chainId].contractAddresses[MODULE_CONTRACT[name]]`.
- Storage key `roles_${moduleType}_${chainId}`; failures never broadcast the popup `error` event; an entry with an errored role is stale.
- Role holders are NOT attachments — do not touch `buildAttachmentIndex`.
- Comments: default none; only non-obvious *why*, 1–2 lines (user rule).
- Commits: plain `git commit` (signs with repo-local key). Never `--no-gpg-sign`. No co-author lines.
- Checks: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`.

## Review Focus

1. Module not configured on the chain (CSM 0x02 on mainnet, CM v1 without the top-up role) → empty/`[]` holders, no RPC call when config is missing, no crash.
2. RPC down → every role for that module carries `error`, tab shows ⚠, no popup banner, refetched on next open.
3. Same address holds roles on several modules → listed under each; `getCode` called once per unique address per fetch.
4. Selecting a holder of another module sends `moduleType` (site switches module); same-module pick omits it.
5. Anvil: contract address resolved with `contractChainId(ctx)` (forked chain) while storage key uses `ctx.chainId` (31337).

---

### Task 1: Bump lido-csm-sdk to 3.0.0

**Files:** Modify `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1:** `pnpm add @lidofinance/lido-csm-sdk@^3.0.0`
- [ ] **Step 2:** Run `pnpm run lint && pnpm run typecheck && pnpm run test`. Expected: PASS. If typecheck fails, fix call sites (SDK diff in `common`/`abi` 2.6→3.0 is only `access-types`/`can-perform`; anything else is a regression worth reporting, not papering over).
- [ ] **Step 3:** Run `pnpm run test:e2e`. Expected: all pass.
- [ ] **Step 4:** Commit: `chore(deps): bump lido-csm-sdk to 3.0.0`

### Task 2: Role registry, types, role cache

**Files:**
- Modify: `lib/shared/modules.ts`, `lib/shared/types.ts`, `playwright/types.ts`
- Create: `lib/background/role-cache.ts`
- Test: `test/background/role-cache.test.ts`

**Interfaces — Produces:**
```ts
// lib/shared/modules.ts
import type { ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
/** Protocol roles the SDK gates widget actions on, and the modules whose contract holds each. */
export const PROTOCOL_ROLES: readonly { role: ProtocolRole; modules: readonly ModuleType[] }[] = [
  { role: 'REPORT_GENERAL_DELAYED_PENALTY_ROLE', modules: MODULE_ORDER },
  { role: 'ENABLE_TOP_UP_ALLOCATION_ROLE', modules: ['cm'] },
];

// lib/shared/types.ts
export type RoleHolder = { address: Address; isContract: boolean };
export type CachedRole = { role: ProtocolRole; holders: RoleHolder[]; error?: string };
export type RoleCacheEntry = { roles: CachedRole[]; lastFetchedAt: number };
// AddressSource gains: | { type: 'role'; role: ProtocolRole }

// lib/background/role-cache.ts
export function rolesFor(moduleType: ModuleType): ProtocolRole[];
export function rolesStorageKey(ctx: CacheContext): string;          // `roles_${moduleType}_${chainId}`
export async function getCachedRoles(ctx: CacheContext): Promise<RoleCacheEntry | null>;
export async function fetchRoles(ctx: CacheContext): Promise<RoleCacheEntry>; // writes storage, never throws
```

`playwright/types.ts` `AddressSource`: add `/** Picked from the Roles tab — provenance only. */ | { type: 'role'; role: string }`.

- [ ] **Step 1: Write failing tests** in `test/background/role-cache.test.ts`, mocking like `test/background/gate-cache.test.ts` (hoisted mocks; `createPublicClient` returns `{ multicall: mockMulticall, getCode: mockGetCode }`; mock `/common` with `MODULE_NAME`, `MODULE_CONFIG` (CSM chain 1 with `csModule: CSM_ADDR`, CM chain 1 with `curatedModule: CM_ADDR`, CSM_02 absent on chain 1), `MODULE_CONTRACT: { CSM: 'csModule', CM: 'curatedModule', CSM_02: 'csModule' }`; mock `/abi` with `BaseModuleAbi`). Cases:
  - `rolesFor('csm')` → `['REPORT_GENERAL_DELAYED_PENALTY_ROLE']`; `rolesFor('cm')` → both roles.
  - `fetchRoles` CM: multicall called once with two `getRoleMembers` calls at `CM_ADDR`, args `[keccak256(toBytes(role))]`, `allowFailure: true`; result `[{status:'success', result:[A, B]}, {status:'success', result:[B]}]`, `getCode` returns `'0x6080'` for B and `undefined` for A → holders `A` EOA, `B` contract; `getCode` called exactly twice (B deduped).
  - Per-role failure: second result `{status:'failure', error: new Error('boom')}` → that role has `error: 'boom'`, `holders: []`; first role intact.
  - Multicall throws → every role of the module has `error`, entry still stored.
  - CSM 0x02 on chain 1 (no config) → `{ roles: [] }`, multicall not called.
  - Anvil ctx `{ chainId: 31337, forkedFrom: 1, moduleType: 'csm', rpcUrl }` → reads `CSM_ADDR`, stored under `roles_csm_31337`.
  - Holders are checksummed (`getAddress`).
  - `getCachedRoles` returns stored entry / `null`.
- [ ] **Step 2:** `pnpm vitest run test/background/role-cache.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `lib/background/role-cache.ts`:

```ts
import { getAddress, keccak256, toBytes, type Address } from 'viem';
import { MODULE_CONFIG, MODULE_CONTRACT, type ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
import { BaseModuleAbi } from '@lidofinance/lido-csm-sdk/abi';
import { PROTOCOL_ROLES } from '../shared/modules.js';
import type { CacheContext, CachedRole, ModuleType, RoleCacheEntry } from '../shared/types.js';
import { errorMessage } from '../shared/errors.js';
import { MODULE_NAMES, contractChainId, getClient } from './client.js';

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

export async function fetchRoles(ctx: CacheContext): Promise<RoleCacheEntry> {
  const entry: RoleCacheEntry = { roles: await readRoles(ctx), lastFetchedAt: Date.now() };
  await chrome.storage.local.set({ [rolesStorageKey(ctx)]: entry });
  return entry;
}

async function readRoles(ctx: CacheContext): Promise<CachedRole[]> {
  const name = MODULE_NAMES[ctx.moduleType];
  const addresses: Record<string, Address | undefined> =
    MODULE_CONFIG[name][contractChainId(ctx)]?.contractAddresses ?? {};
  const address = addresses[MODULE_CONTRACT[name]];
  const roles = rolesFor(ctx.moduleType);
  if (!address) return [];

  try {
    const client = getClient(ctx);
    const results = await client.multicall({
      allowFailure: true,
      contracts: roles.map((role) => ({
        address, abi: BaseModuleAbi, functionName: 'getRoleMembers', args: [keccak256(toBytes(role))],
      }) as const),
    });
    const members = results.map((r) => (r.status === 'success' ? r.result.map((a) => getAddress(a)) : []));
    const unique = [...new Set(members.flat())];
    const codes = await Promise.all(unique.map((a) => client.getCode({ address: a })));
    const isContract = new Map(unique.map((a, i) => [a, !!codes[i] && codes[i] !== '0x']));
    return roles.map((role, i) => {
      const r = results[i]!;
      return r.status === 'success'
        ? { role, holders: members[i]!.map((a) => ({ address: a, isContract: isContract.get(a)! })) }
        : { role, holders: [], error: errorMessage(r.error) };
    });
  } catch (err) {
    return roles.map((role) => ({ role, holders: [], error: errorMessage(err) }));
  }
}
```
Adjust to whatever `MODULE_CONFIG`/`multicall` typing demands (gate-cache casts `contractAddresses` the same way). Add `PROTOCOL_ROLES` to `modules.ts`, the types to `types.ts`, the `AddressSource` variants.
- [ ] **Step 4:** Test passes; `pnpm run typecheck && pnpm run lint` pass.
- [ ] **Step 5:** Commit `feat(roles): cache protocol role holders per module`.

### Task 3: Background wiring

**Files:**
- Modify: `lib/shared/messages.ts`, `entrypoints/background.ts`
- Test: `test/background/request-roles.test.ts` (copy the harness of `test/background/request-gates.test.ts`, mocking `role-cache.ts` instead of `gate-cache.ts`)

**Interfaces — Produces:**
```ts
// PopupCommand
| { type: 'request-roles'; origin: string; chainId: number; moduleType: ModuleType }
| { type: 'refresh-roles'; origin: string; chainId: number; moduleType: ModuleType }
// PopupEvent
| { type: 'roles-update'; chainId: number; moduleType: ModuleType; roles: CachedRole[]; lastFetchedAt: number }
| { type: 'roles-loading'; chainId: number; moduleType: ModuleType; loading: boolean }
```

- [ ] **Step 1: Failing tests** (same cases request-gates.test.ts covers for gates): cached fresh entry → `roles-update` broadcast, no fetch; stale or errored-role entry → `fetchRoles` called; `refresh-roles` forces fetch; unresolvable Anvil ctx → `roles-loading false`; `fetchRoles` rejects → no `{type:'error'}` event.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `triggerRoleRefresh` beside `triggerGateRefresh` in `entrypoints/background.ts`:

```ts
function triggerRoleRefresh(ctx: CacheContext, force = false) {
  const { chainId, moduleType } = ctx;
  return refreshCached({
    key: `roles:${moduleType}:${chainId}`,
    getCached: () => getCachedRoles(ctx),
    fetch: () => fetchRoles(ctx),
    update: (e) => broadcastToPopups({ type: 'roles-update', chainId, moduleType, roles: e.roles, lastFetchedAt: e.lastFetchedAt }),
    loading: (loading) => broadcastToPopups({ type: 'roles-loading', chainId, moduleType, loading }),
    fail: (err) => console.warn('Role fetch failed:', err),
    stale: (e) => isStale(e) || e.roles.some((r) => r.error),
  }, force);
}
```
and `case 'request-roles'` / `case 'refresh-roles'` mirroring the gate cases (lines ~498–510). If the gate and role cases are now identical apart from the trigger, fold them into one shared helper instead of copy-pasting.
- [ ] **Step 4:** Tests pass; full `pnpm run test` passes.
- [ ] **Step 5:** Commit `feat(roles): serve role holders to the popup`.

### Task 4: Roles tab UI

**Files:**
- Modify: `lib/shared/types.ts` (`PopupTab` += `'roles'`), `lib/popup/hooks.ts`, `entrypoints/popup/App.tsx`, `entrypoints/popup/style.css`
- Create: `entrypoints/popup/RoleHolders.tsx`
- Test: `test/popup/role-holders.test.tsx`, additions in `test/popup/hooks.test.ts` (or a new `test/popup/use-role-holders.test.ts` modelled on `use-shared-addresses.test.ts`)

**Interfaces — Produces:**
```ts
// lib/popup/hooks.ts
export type RoleGroup = {
  role: ProtocolRole;
  entries: { moduleType: ModuleType; holders: RoleHolder[]; error?: string }[];
};
/** Pure: PROTOCOL_ROLES order, then MODULE_ORDER; only modules in `wanted` that hold the role. */
export function groupRoles(byModule: Partial<Record<ModuleType, CachedRole[]>>, wanted: ModuleType[]): RoleGroup[];
export function useRoleHolders(
  port: chrome.runtime.Port | null, origin: string | null, chainId: number,
  availableModules: ModuleAvailability, enabled: boolean,
): { groups: RoleGroup[]; loading: boolean; refresh: () => void };
```
Extract the `resolved`/`wanted` derivation at the top of `useSharedAddresses` into `useWantedModules(availableModules): { wanted: ModuleType[]; resolved: boolean }` and use it in both hooks. `useRoleHolders` posts `request-roles` per wanted module when `enabled && resolved`, listens for `roles-update`/`roles-loading` for the current `chainId`, and stays `loading` until every wanted module has answered (same settle logic as gates). A module whose role list arrives empty (no config) yields no entry.

`RoleHolders.tsx` props:
```ts
type Props = {
  groups: RoleGroup[];
  loading: boolean;
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSelect: (address: Address, role: ProtocolRole, moduleType: ModuleType) => void;
  onRefresh: () => void;
};
```
Render (reuse existing classes/tokens from `style.css` — `.panel`, `.section-label`, `.btn-copy`, `useCopyAddress`, `truncateAddress`, the `.manual-entry` row look):
- Top bar with a refresh button (same look as Shared's refresh).
- Loading → existing loading state; no groups after load → `.empty-state` "No protocol roles on this network."
- Per group: `<details className="role-group" open>` with `<summary>`: role constant, module scope (`MODULE_SHORT` joined by ` · `), total holder count.
- Per entry: `error` → row `MODULE ⚠` with `data-hint={error}`; empty holders → `MODULE — no holders` (dim); else one `.role-row` per holder: `MODULE_SHORT` tag, label (from `addressLabels[address.toLowerCase()]`) above truncated address, `contract`/`EOA` tag, copy button (stopPropagation). Row `selected` when it matches `selectedAddress` (case-insensitive). Click → `onSelect(address, role, moduleType)`.

`App.tsx`:
- Tab list: insert `['roles', 'Roles']` between Manual and Anvil.
- `useRoleHolders(port, origin, state.chainId, availableModules, rolesVisited)` with a visited ref exactly like `sharedVisitedRef`, so nothing is fetched until the tab is opened.
- `onSelect` → `send({ type: 'select-address', address, source: { type: 'role', role }, ...(moduleType !== state.moduleType ? { moduleType } : {}) })`.

`style.css`: `.tab { padding: 10px 8px; }` (was `10px`), plus minimal `.role-group`/`.role-row` styles using existing tokens.

- [ ] **Step 1: Failing tests:**
  - `groupRoles`: CSM + CM penalty, CM top-up → two groups in `PROTOCOL_ROLES` order; penalty entries in `MODULE_ORDER`; module not in `wanted` excluded; errored role kept with `error`.
  - `useRoleHolders`: posts `request-roles` for each wanted module only once availability is resolved; `loading` true until every module answered; ignores events for another `chainId`; `refresh` posts `refresh-roles`.
  - `RoleHolders`: renders role headers and holder rows with `contract`/`EOA`; label shown; click calls `onSelect(address, role, moduleType)`; copy click doesn't select; ⚠ row for errored entry; "no holders" for empty; selected row has `selected` class.
  - App: selecting a CM holder while site module is `csm` sends `moduleType: 'cm'`; selecting a CSM holder sends no `moduleType` (extend an existing App test such as `test/popup/app-active-tab.test.tsx` style).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `pnpm run lint && pnpm run typecheck && pnpm run test` pass.
- [ ] **Step 5:** Commit `feat(popup): add Roles tab with protocol role holders`.

### Task 5: E2E, docs, visual check

**Files:**
- Modify: `test/e2e/helpers.ts`, `AGENTS.md`, `README.md` (only if it documents tabs or `AddressSource`)
- Create: `test/e2e/roles.e2e.ts`

- [ ] **Step 1:** `helpers.ts`: `seedRoles(sw, roles: CachedRole[], chainId, moduleType = 'csm', lastFetchedAt = Date.now())` writing `roles_${moduleType}_${chainId}` (same shape as `seedGates`); `TabName` += `'Roles'`; `goToTab` waits for `.role-group, .empty-state` on Roles.
- [ ] **Step 2:** `roles.e2e.ts` (model on `gate-proofs.e2e.ts`): seed state chain 1 / csm, module availability `{ csm02: false, cm: true }`, roles for csm (penalty: EOA_A) and cm (penalty: EOA_A, top-up: CONTRACT_B with `isContract: true`), plus one errored role in a second case. Tests: Roles tab shows both role groups; top-up group lists CONTRACT_B with `contract` tag; clicking CONTRACT_B connects it and the module chip switches to CM; errored role shows ⚠; tab bar has no horizontal overflow on Anvil-less CM (`scrollWidth <= clientWidth` on `.tabs`).
- [ ] **Step 3:** `pnpm run test:e2e` → all pass.
- [ ] **Step 4:** `AGENTS.md`: file-structure lines for `lib/background/role-cache.ts` and `entrypoints/popup/RoleHolders.tsx`; rewrite the "Settings is not a tab" gotcha (tab bar fits six tabs at 8px padding — Operators/Groups/Shared/Manual/Roles/Anvil — a seventh overflows); new gotcha "Protocol roles": `PROTOCOL_ROLES` registry typed on SDK `ProtocolRole`, both roles on the module contract, read via `BaseModuleAbi.getRoleMembers` (CuratedModule ABI lacks it), holders are not attachments, failures never raise the banner; "E2E seeds roles": specs opening Roles call `seedRoles`.
- [ ] **Step 5:** Visual check: `pnpm run build`, load in the e2e browser on CM + Anvil-like state (six tabs) and screenshot the popup; confirm one-line tab bar and readable role headers at 400px.
- [ ] **Step 6:** Commit `test(e2e): cover Roles tab` and `docs: document Roles tab` (or one commit).
