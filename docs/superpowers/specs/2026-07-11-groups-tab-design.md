# Groups tab — promote grouped operator view to a top-level tab

**Date:** 2026-07-11
**Topic:** Replace the in-tab list⇄grouped switcher with a dedicated Groups tab

## Problem

CM operators can be viewed flat or bucketed by group. Today that choice is a
per-site `ViewToggle` (list/grouped icons) tucked into the Operators tab's search
row, driven by persisted `operatorViewMode` state. Grouping is a distinct way of
browsing, not a display tweak — it deserves a first-class tab, and the toggle adds
state and UI weight for what should be navigation.

## Goal

Tabs become: `Operators · Groups · Manual · [Anvil] · Settings`.

- **Groups** is placed immediately after Operators.
- **Groups** renders only when `moduleType === 'cm'` — CSM operators have no groups
  (`lib/shared/groups.ts`: "CSM operators never appear here").
- The list/grouped switcher and all its supporting state are removed.

## Non-goals

- No change to how groups are computed, rendered, filtered, or favourited —
  `OperatorGroups`, `groupOperators`, `filterGroupedView`, group favourites all stay.
- No graceful "you were in grouped view, land on Groups" migration (kept minimal —
  see Migration).

## Design

### Tab visibility & fallback

- `PopupTab` gains `'groups'`: `'operators' | 'groups' | 'manual' | 'anvil'`.
- Groups tab is shown only when `moduleType === 'cm'`.
- `activeTab` is **derived**, not stored-and-corrected, mirroring the existing Anvil
  pattern (App.tsx:128). Two fallbacks compose:
  - selected tab is `anvil` but not on Anvil → `operators`
  - selected tab is `groups` but module isn't CM → `operators`
- Result: switching CM → CSM while on Groups lands the user on Operators, with no
  effect and no blank frame.

### Removed switcher machinery

| Item | Location | Action |
|------|----------|--------|
| `ViewToggle` component | `OperatorGroups.tsx` | delete |
| `useViewMode` hook | `lib/popup/hooks.ts` | delete |
| `set-view-mode` message | `lib/shared/messages.ts` | delete |
| `set-view-mode` handler | `entrypoints/background.ts` | delete |
| `OperatorViewMode` type, `operatorViewMode` field + default | `lib/shared/types.ts` | delete |
| `.view-toggle*` rules | `entrypoints/popup/style.css` | delete |

### Shared toolbar, forked body (App.tsx)

Operators and Groups both need the search box + filter pills + staleness/refresh row.
To avoid duplicating that ~50-line block, extract a `SearchToolbar` component and
render one shared block for both tabs:

```tsx
{(activeTab === 'operators' || activeTab === 'groups') && (
  <>
    <SearchToolbar
      search={search} setSearch={setSearch}
      filterGroup={filterGroup} setFilterGroup={setFilterGroup}
      showPending={activeTab === 'operators'}   // Pending is list-only
      loading={loading} lastFetchedAt={lastFetchedAt} refresh={refresh}
      searchInputRef={searchInputRef}
    />
    {/* Anvil-not-detected empty state — shared, unchanged */}
    {activeTab === 'groups'
      ? <OperatorGroups operators={operators} scope={scope} … />
      : <OperatorList operators={displayOperators} … />}
  </>
)}
```

- `search` / `filterGroup` stay lifted in `App`, so state is **shared** across the
  two tabs (a search typed in Operators carries into Groups, and vice-versa).
- `showPending` gates the Pending pill (grouped view never supported it).
- The existing effect that resets `filterGroup` off `pending` re-keys from
  `effectiveViewMode === 'grouped'` to `activeTab === 'groups'`.
- `scope` passed to `OperatorGroups` = `filterGroup` (which on the Groups tab is only
  ever `all` | `favorites` because Pending isn't reachable there).
- Ctrl+K continues to route to Operators + focus search. A single `searchInputRef` is
  passed to `SearchToolbar`; only the mounted tab's input is live, so the ref resolves
  correctly.

### Migration

None required. `getSiteState` already merges `{ ...DEFAULT_SITE_STATE, ...stored }`,
so a leftover `operatorViewMode` value in stored site state is silently ignored once
the field is removed from the type. No stored `activeTab` value is invalidated (we
only add `'groups'`). Users who last used grouped view land on Operators once; their
tab choice then persists as normal.

## Testing

- **Unchanged / still valid:** `test/popup/grouped-view.test.ts`,
  `test/popup/group-filter.test.ts` (OperatorGroups + filter helpers untouched).
- **Update:** `test/fixtures.ts` `makeState()` — drop `operatorViewMode`. Remove any
  `set-view-mode` / `ViewToggle` assertions.
- **Add:**
  - Groups tab appears when `moduleType === 'cm'`, absent when `csm`.
  - Selecting Groups then switching to CSM derives back to Operators.
  - Groups tab renders the grouped accordion (reuse grouped-view expectations).
  - Search + All/Favorites toolbar present on Groups; Pending pill absent.
  - `set-active-tab` accepts and persists `'groups'`.

## Files touched

- `lib/shared/types.ts` — `PopupTab += 'groups'`; drop `OperatorViewMode` + field.
- `lib/shared/messages.ts` — drop `set-view-mode`.
- `lib/popup/hooks.ts` — drop `useViewMode`.
- `entrypoints/background.ts` — drop `set-view-mode` case.
- `entrypoints/popup/OperatorGroups.tsx` — drop `ViewToggle`.
- `entrypoints/popup/App.tsx` — add Groups tab + derivation; extract a
  `SearchToolbar` component (co-located in App.tsx unless it grows large enough to
  warrant its own file); remove viewMode usage.
- `entrypoints/popup/style.css` — drop `.view-toggle*`.
- `test/fixtures.ts` + popup tests — per Testing.
