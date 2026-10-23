---
date: 2026-10-22
topic: protocol-roles-tab
---

# Protocol Role Holders Tab

## What We're Building

A **Roles** tab listing the holders of the SDK's protocol roles, grouped by role, each
selectable as the connected address.

## Why

lido-csm-sdk 3.0 gates widget actions on OpenZeppelin AccessControl roles
(`AccessLevel.PROTOCOL_ROLE`): `reportGeneralDelayedPenalty`/`cancelGeneralDelayedPenalty` need
`REPORT_GENERAL_DELAYED_PENALTY_ROLE`, `enableTopUpAllocation` needs
`ENABLE_TOP_UP_ALLOCATION_ROLE`. QA needs to connect as a holder to see those flows — today
that means reading `getRoleMembers` by hand. On Anvil the holder can be impersonated and the tx
actually signed; elsewhere it's watch-only.

## Why a Tab, Not a Shared Chip

Considered folding role holders into the attachment index (a sibling of the Gate chip). Chosen
a dedicated tab instead: QA looks for "who holds role X", so grouping by role reads better than
address-first rows. The cost is a sixth tab on CM + Anvil, solved by tightening tab padding.
Role holders are **not** attachments — Shared and the connected bar's hover panel don't show them.

## Scope

- Roles = SDK `ProtocolRole`, both held on the **module contract**:
  - `REPORT_GENERAL_DELAYED_PENALTY_ROLE` — every module (BaseModule).
  - `ENABLE_TOP_UP_ALLOCATION_ROLE` — CM only.
- Registry `PROTOCOL_ROLES` in `lib/shared/modules.ts`, typed against the SDK's `ProtocolRole`
  (type-only export — the list itself must be local), so an SDK rename breaks typecheck.
- Out: other `*_ROLE`s, role attachments, "grant role to me" on Anvil.

## Data Layer (service worker)

`lib/background/role-cache.ts`, mirroring `gate-cache.ts`, per `CacheContext`:

1. Module address = `MODULE_CONFIG[module][contractChainId].contractAddresses[MODULE_CONTRACT]`
   (Anvil resolves via `forkedFrom`). Missing config → empty entry, no RPC.
2. One `multicall` of `getRoleMembers(keccak256(toBytes(role)))` per applicable role, using
   `BaseModuleAbi` (CuratedModule's SDK ABI lacks the enumerable getters; the CM contract has
   them). Role ids follow the OZ `keccak256("NAME")` convention — no getter round-trip.
3. `getCode` per unique holder → `isContract`. Holders are often Safes / EasyTrack executors —
   usable only on Anvil.
4. Per-role isolation: a failing read stores `error` on that role, the rest land. A role absent
   on the contract version (CM v1 has no top-up role) returns `[]` → shown as "no holders".

Storage (`chrome.storage.local`): `roles_${module}_${chainId}` →
`{ roles: CachedRole[], lastFetchedAt }`, `CachedRole = { role, holders: { address, isContract }[], error? }`.

Same refresh contract as gates: `request-roles` / `refresh-roles` commands, `roles-update` /
`roles-loading` events, failures never raise the popup error banner, an entry holding an
errored role counts as stale.

## Popup

- `PopupTab` gains `'roles'`; tab sits between Manual and Anvil, always shown.
- `useRoleHolders` requests the site's current module only (`state.moduleType`); no availability
  wait. Why: selecting a holder from another module would switch the site's module anyway, and
  Operators/Groups are per-module too. Shared is the deliberate cross-module tab.
- `RoleHolders.tsx`: one collapsible section per role (header: role name, holder count). Rows:
  address label (reuses `addressLabels`), truncated address, `contract`/`EOA` tag, copy button.
  No module tag. Errored role → ⚠ with the message as hint. Connected address highlighted.
  Filter bar shows `updated {time ago}` like Shared.
- Selecting a row sends `select-address` with source `{ type: 'role', role }` and no `moduleType`
  — no module switch.
- Tab overflow: six tabs take ~362 of the 440px popup at the default 10px `.tab` padding, so no
  padding change; guarded by an e2e overflow check on CM + Anvil.

## Testing

- Unit: `role-cache` (multicall/getCode mocked like `gate-cache.test.ts`), `request-roles`
  background test, `RoleHolders` component test.
- E2E: `seedRoles(...)` helper writing `roles_*` entries; spec opens Roles, selects a holder,
  checks the connected address.

## SDK Bump

Lands first, own commit: `@lidofinance/lido-csm-sdk` `^2.6.0` → `^3.0.0`. The 2.6 → 3.0 diff in
`common`/`abi` (the only subpaths we import) is `access-types` + `can-perform` only; breaking
changes are in tx/discovery SDKs we don't use.
