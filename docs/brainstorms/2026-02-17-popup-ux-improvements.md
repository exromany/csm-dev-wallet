---
date: 2026-02-17
topic: popup-ux-improvements
---

# Popup UX Improvements

## What We're Building

Four improvements to the popup UX:

### 1. Loading & empty states for operator list

Currently the list renders nothing while operators load. Add:
- **Loading state**: spinner or skeleton while `loading === true` and no cached operators
- **Empty state**: "No operators found" when loaded (`loading === false`) but `allOperators.length === 0`
- **No matches**: "No matching operators" when search/favorites filter produces empty `displayOperators`

Implementation:
- `OperatorList` component receives `loading` prop (already does) — add conditional renders
- Distinguish "loading with no cache" vs "loading with stale cache" (stale cache shows operators + spinner)

### 2. Default CSM only, CM enabled after SM discovery verification

- CSM always enabled
- CM disabled by default until `SMDiscovery.moduleCache(cmModuleId) != zeroAddress` confirms
- `useModuleAvailability` initial state: `{ csm: true, cm: false }` (was `{ csm: true, cm: true }`)
- ModuleSelector grays out CM until verification completes

### 3. Persist CM availability in `chrome.storage.local`

- Cache key: `module_availability_{chainId}` → `{ csm: boolean, cm: boolean, checkedAt: number }`
- On popup open: load cached value immediately, recheck in background
- Recheck if `Date.now() - checkedAt > 5 * 60 * 1000` (5 min TTL)
- Network switch: invalidate and recheck
- Background broadcasts `module-availability` event after each check

### 4. Improved operator search

Current filter (hooks.ts:92-101) only matches `op.id` and two addresses. Improve to:

- **`#N` exact ID match**: `#1` matches operator with `id === '1'` only (not `10`, `11`, etc.)
- **Bare number partial match**: `1` still matches `1`, `10`, `11` (current behavior)
- **Case-insensitive address**: already lowercases, but add `proposedManagerAddress` and `proposedRewardsAddress`
- **Operator type**: match `op.operatorType` (e.g., searching "DEF" or "def" finds default-type operators)
- Update search placeholder: `"Search by #ID, address, or type..."`

## Key Decisions

- **CM default false**: prevents flash of CM button appearing available then disabling
- **Persist availability**: avoids re-checking on every popup open within 5 min
- **`#` prefix = exact ID**: intuitive UX, doesn't conflict with address search (addresses start with `0x`)

## Status: Implemented

All four improvements implemented:

1. **Loading & empty states** — `OperatorList` receives `allOperatorsCount` prop, distinguishes "Loading operators..." / "No operators found" / "No matching operators"
2. **CM default false** — `useModuleAvailability` initial state changed to `{ csm: true, cm: false }`
3. **Persistent availability cache** — `getModuleAvailabilityCache()` / `setModuleAvailabilityCache()` in `operator-cache.ts`; background sends persisted value immediately on `get-state` and `switch-network`, then rechecks via RPC; `isModuleAvailable()` short-circuits on persisted `cm: true`
4. **Improved search** — `#N` exact ID match, operator type search, proposed address search; placeholder updated
