# Groups Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-Operators-tab list⇄grouped `ViewToggle` with a dedicated, CM-only **Groups** tab placed right after Operators.

**Architecture:** The grouped view stops being a persisted `operatorViewMode` display toggle and becomes a top-level tab. All switcher machinery (`ViewToggle`, `useViewMode`, `set-view-mode`, `operatorViewMode`) is deleted. The Operators and Groups tabs share one extracted `SearchToolbar` and shared `search`/`filterGroup` state; the tab body forks between `OperatorList` and `OperatorGroups`. Tab visibility is *derived* (not stored-and-corrected), mirroring the existing Anvil-only pattern.

**Tech Stack:** WXT + React + viem, vitest + @testing-library/react. Spec: `docs/superpowers/specs/2026-07-11-groups-tab-design.md`.

## Global Constraints

- Groups tab renders **only** when `state.moduleType === 'cm'`. CSM has no groups.
- Tab order: `Operators · Groups · Manual · [Anvil] · Settings`.
- `PopupTab` = `'operators' | 'groups' | 'manual' | 'anvil'`. Settings is never persisted (existing rule).
- Groups tab toolbar = search box + `All`/`Favorites` pills only. **No `Pending` pill** (list-only).
- `search` and `filterGroup` state are shared across Operators and Groups (lifted in `App`).
- Leaving CM while on Groups, or leaving Anvil while on Anvil, derives `activeTab → 'operators'`. No effect, no blank frame.
- Use `.js` extensions in TS imports (ESM/WXT). TypeScript strict.
- No state migration code (the `{ ...DEFAULT_SITE_STATE, ...stored }` merge in `getSiteState` makes a leftover `operatorViewMode` value harmless).
- Verification commands: `npm run typecheck`, `npm run test`.

---

### Task 1: Retire the switcher and wire the Groups tab

Lands the entire refactor typecheck-green with the existing suite passing. Includes one anchor App test proving the Groups tab, plus repair of the two existing tests that assert now-deleted `operatorViewMode` behavior.

**Files:**
- Modify: `lib/shared/types.ts` (PopupTab + remove OperatorViewMode)
- Modify: `lib/shared/messages.ts` (remove `set-view-mode`)
- Modify: `lib/popup/hooks.ts` (remove `useViewMode`)
- Modify: `entrypoints/background.ts:510-515` (remove `set-view-mode` case)
- Modify: `entrypoints/popup/OperatorGroups.tsx` (remove `ViewToggle` export)
- Modify: `entrypoints/popup/App.tsx` (Groups tab + `SearchToolbar` + derivation; drop viewMode)
- Modify: `entrypoints/popup/style.css:478-506` (remove `.view-toggle*`)
- Modify (repair): `test/fixtures.ts:25,44`, `test/background/state.test.ts:116,258-280`
- Test (anchor): `test/popup/app-active-tab.test.tsx`

**Interfaces:**
- Produces: `PopupTab` now includes `'groups'`. `SearchToolbar` component (co-located in `App.tsx`) with the prop shape shown in Step 6. `useViewMode`, `ViewToggle`, `OperatorViewMode`, `set-view-mode` no longer exist.
- Consumes: existing `OperatorGroups` (unchanged), `OperatorList`, `useOperators` (`lastFetchedAt: number | null`), `filterByGroup`, `FilterGroup`.

- [ ] **Step 1: Write the anchor test (failing)**

Add to `test/popup/app-active-tab.test.tsx`. First widen the `tab()` helper union on line 20 to include `'Groups'`:

```ts
function tab(name: 'Operators' | 'Groups' | 'Manual' | 'Anvil' | 'Settings') {
  return screen.getByRole('button', { name });
}
```

Then append this describe block:

```tsx
describe('App — Groups tab', () => {
  let port: MockPort;
  beforeEach(() => { port = createMockPort(); });

  it('shows the Groups tab right after Operators when the module is CM', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'cm' }) } satisfies PopupEvent);
    });

    const tabs = screen.getAllByRole('button').filter((b) =>
      ['Operators', 'Groups', 'Manual', 'Settings'].includes(b.textContent ?? ''),
    );
    expect(tabs.map((b) => b.textContent)).toEqual(['Operators', 'Groups', 'Manual', 'Settings']);
  });

  it('hides the Groups tab for CSM', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm' }) } satisfies PopupEvent);
    });
    expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
  });

  it('falls back to Operators when the persisted tab is Groups but the module is CSM', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm', activeTab: 'groups' }) } satisfies PopupEvent);
    });
    expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
    expect(tab('Operators')).toHaveClass('active');
  });
});
```

- [ ] **Step 2: Run the anchor test to verify it fails**

Run: `npm run test -- app-active-tab`
Expected: FAIL — no `Groups` button rendered (and `makeState` may still carry `operatorViewMode`, ignored at runtime).

- [ ] **Step 3: Update the shared layer (types, messages, hooks, background)**

`lib/shared/types.ts` — change line 50-54 region. Delete `OperatorViewMode` and widen `PopupTab`:

```ts
// (delete the `export type OperatorViewMode = 'list' | 'grouped';` line)

// Persistable popup tabs. Settings is deliberately excluded — it's a transient
// destination we never want to land on when the popup reopens.
export type PopupTab = 'operators' | 'groups' | 'manual' | 'anvil';
```

In `SiteState` (line 57-64) remove the `operatorViewMode` field; in `DEFAULT_SITE_STATE` (line 66-73) remove the `operatorViewMode: 'list',` line.

`lib/shared/messages.ts` — remove `OperatorViewMode` from the import on line 9 (keep `ModuleType, PopupTab`), and delete line 56 (`| { type: 'set-view-mode'; ... }`).

`lib/popup/hooks.ts` — delete the entire `useViewMode` block (lines 324-335) and remove the now-unused `OperatorViewMode` import if present.

`entrypoints/background.ts` — delete the `set-view-mode` case (lines 510-515):

```ts
      case 'set-view-mode': {
        await setSiteState(command.origin, { operatorViewMode: command.mode });
        const state = await getComposedState(command.origin);
        broadcastToPopups({ type: 'state-update', state });
        break;
      }
```

- [ ] **Step 4: Remove `ViewToggle`**

`entrypoints/popup/OperatorGroups.tsx` — delete the entire `export function ViewToggle({...})` block (lines 259-291). Leave the rest of the file untouched.

- [ ] **Step 5: Remove `.view-toggle` CSS**

`entrypoints/popup/style.css` — delete lines 478-506 (the `.view-toggle`, `.view-toggle-btn`, `.view-toggle-btn:hover`, `.view-toggle-btn.active` rules) and the trailing blank line, so `.search-bar input` (was line 508) follows `.search-bar` styles directly.

- [ ] **Step 6: Rewrite `App.tsx` — Groups tab + `SearchToolbar`**

Imports (lines 2-24): drop `useViewMode` from the hooks import; change the OperatorGroups import to `import { OperatorGroups } from './OperatorGroups.js';` (no `ViewToggle`).

Delete `const [viewMode, setViewMode] = useViewMode(state, send);` (line 43) and the `effectiveViewMode` line (134).

Add after `const onAnvil = state.chainId === ANVIL_CHAIN_ID;`:

```tsx
  const showGroups = state.moduleType === 'cm';
```

Replace the `activeTab` derivation (line 125-128) with:

```tsx
  // Until the user touches a tab this session, follow the persisted choice.
  const selectedTab = tab ?? state.activeTab;
  // Derive so tabs that don't exist in the current context fall back cleanly —
  // Anvil only on the Anvil network, Groups only for CM. No effect, no blank frame.
  let activeTab: Tab = selectedTab;
  if (!onAnvil && activeTab === 'anvil') activeTab = 'operators';
  if (!showGroups && activeTab === 'groups') activeTab = 'operators';
```

Replace the pending-reset effect (lines 136-142) with one keyed on the Groups tab:

```tsx
  // Pending isn't available in grouped mode — drop back to "All" when the Groups
  // tab is active so the filter pills match what's actually shown.
  useEffect(() => {
    if (activeTab === 'groups' && filterGroup === 'pending') {
      setFilterGroup('all');
    }
  }, [activeTab, filterGroup]);
```

Replace the tab bar (lines 191-208) so Groups is inserted after Operators, CM-only:

```tsx
      <div className="tabs">
        {(
          [
            ['operators', 'Operators'],
            ...(showGroups ? ([['groups', 'Groups']] as const) : []),
            ['manual', 'Manual'],
            ...(onAnvil ? ([['anvil', 'Anvil']] as const) : []),
            ['settings', 'Settings'],
          ] satisfies ReadonlyArray<readonly [Tab, string]>
        ).map(([t, label]) => (
          <button
            key={t}
            className={`tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => selectTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
```

Replace the Operators content block (lines 211-309) with a shared Operators+Groups block that renders the extracted `SearchToolbar`, the shared Anvil empty-state, then forks the body:

```tsx
        {(activeTab === 'operators' || activeTab === 'groups') && (
          <>
            <SearchToolbar
              search={search}
              onSearch={setSearch}
              searchInputRef={searchInputRef}
              filterGroup={filterGroup}
              onFilterGroup={setFilterGroup}
              showPending={activeTab === 'operators'}
              loading={loading}
              lastFetchedAt={lastFetchedAt}
              onRefresh={refresh}
            />
            {state.chainId === ANVIL_CHAIN_ID && !anvilStatus.forkedFrom && !loading && (
              <div className="empty-state">
                Anvil not detected.
                <br />
                Start a local fork to browse operators.
              </div>
            )}
            {activeTab === 'groups' ? (
              <OperatorGroups
                operators={operators}
                allOperatorsCount={allOperators.length}
                loading={loading}
                scope={filterGroup}
                selectedAddress={state.selectedAddress?.address}
                favorites={favorites}
                groupFavorites={groupFavorites}
                operatorLabels={operatorLabels}
                onSelect={(address, operatorId, role) =>
                  send({
                    type: 'select-address',
                    address,
                    source: { type: 'operator', operatorId, role },
                  })
                }
              />
            ) : (
              <OperatorList
                operators={displayOperators}
                allOperatorsCount={allOperators.length}
                loading={loading}
                selectedAddress={state.selectedAddress?.address}
                favorites={favorites}
                operatorLabels={operatorLabels}
                onSelect={(address, operatorId, role) =>
                  send({
                    type: 'select-address',
                    address,
                    source: { type: 'operator', operatorId, role },
                  })
                }
              />
            )}
          </>
        )}
```

Add the `SearchToolbar` component at the bottom of `App.tsx` (below the `App` function). It holds the search-row + filter-bar markup formerly inline in the Operators tab, with the `ViewToggle` removed and the `Pending` pill gated by `showPending`:

```tsx
function SearchToolbar({
  search,
  onSearch,
  searchInputRef,
  filterGroup,
  onFilterGroup,
  showPending,
  loading,
  lastFetchedAt,
  onRefresh,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  filterGroup: FilterGroup;
  onFilterGroup: (group: FilterGroup) => void;
  showPending: boolean;
  loading: boolean;
  lastFetchedAt: number | null;
  onRefresh: () => void;
}) {
  return (
    <div className="search-wrapper">
      <div className="search-row">
        <div className="search-bar">
          <span className="search-icon">⌕</span>
          <input
            ref={searchInputRef}
            placeholder="Search #ID, address, label…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search ? (
            <button className="search-clear" onClick={() => onSearch('')}>×</button>
          ) : (
            <kbd className="kbd">⌘K</kbd>
          )}
        </div>
      </div>
      <div className="filter-bar">
        <button
          className={`filter-btn ${filterGroup === 'all' ? 'active' : ''}`}
          onClick={() => onFilterGroup('all')}
        >
          All
        </button>
        <button
          className={`filter-btn ${filterGroup === 'favorites' ? 'active' : ''}`}
          onClick={() => onFilterGroup('favorites')}
        >
          Favorites
        </button>
        {showPending && (
          <button
            className={`filter-btn ${filterGroup === 'pending' ? 'active' : ''}`}
            onClick={() => onFilterGroup('pending')}
            title="Operators with pending P-MGR or P-RWD role-change proposals"
          >
            Pending
          </button>
        )}
        <div className="spacer" />
        {lastFetchedAt && (
          <span className="staleness-label">
            updated {formatTimeAgo(lastFetchedAt)}
          </span>
        )}
        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'loading…' : '↻ refresh'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Repair the tests that assert deleted behavior**

`test/fixtures.ts` — delete the `operatorViewMode: 'list',` line inside `makeState` (line 25) and inside `makeSiteState` (line 44).

`test/background/state.test.ts`:
- Line 116: remove `operatorViewMode: 'list'` from the legacy `site_states` fixture, leaving `{ chainId: 1, moduleType: 'csm', selectedAddress: null, isConnected: false }`.
- Delete the two obsolete tests entirely: `it('hydrates operatorViewMode default on legacy site state', …)` (lines 258-270) and `it('persists operatorViewMode per-origin via setSiteState', …)` (lines 272-280). (Per-origin `activeTab` persistence is already covered by `test/background/set-active-tab.test.ts`.)

- [ ] **Step 8: Run typecheck and the full test suite**

Run: `npm run typecheck`
Expected: PASS (no dangling `OperatorViewMode` / `useViewMode` / `set-view-mode` references).

Run: `npm run test`
Expected: PASS — including the three new anchor tests; no `operatorViewMode` failures.

- [ ] **Step 9: Commit**

```bash
git add lib/shared/types.ts lib/shared/messages.ts lib/popup/hooks.ts entrypoints/background.ts entrypoints/popup/OperatorGroups.tsx entrypoints/popup/App.tsx entrypoints/popup/style.css test/fixtures.ts test/background/state.test.ts test/popup/app-active-tab.test.tsx
git commit -m "feat(popup): promote grouped view to a Groups tab"
```

---

### Task 2: Groups-tab behavior coverage

Adds the remaining behavior tests: grouped accordion renders inside the tab with real operator data, the toolbar shows search + All/Favorites but not Pending, and selecting Groups persists `'groups'` via `set-active-tab`.

**Files:**
- Test (create): `test/popup/groups-tab.test.tsx`

**Interfaces:**
- Consumes: `App`, `createMockPort`/`MockPort` from `test/setup.js`, `makeState`/`makeOperator` from `test/fixtures.js`, `PopupEvent` from `lib/shared/messages.js`. Emits `state-update` (with `moduleType: 'cm'`) and `operators-update` (`chainId`, `moduleType: 'cm'`, `operators`, `lastFetchedAt`) through the mock port — the same event shape `useOperators` listens for (`lib/popup/hooks.ts:162-181`).

- [ ] **Step 1: Write the behavior tests (failing/asserting new UI)**

Create `test/popup/groups-tab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState, makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

const TEST_ORIGIN = 'https://stake.lido.fi';

async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

// Seed a CM site with two grouped operators + one ungrouped.
function seedCm(port: MockPort) {
  act(() => {
    port._emit({ type: 'state-update', state: makeState({ moduleType: 'cm' }) } satisfies PopupEvent);
  });
  act(() => {
    port._emit({
      type: 'operators-update',
      chainId: 1,
      moduleType: 'cm',
      lastFetchedAt: 1_700_000_000_000,
      operators: [
        makeOperator({ id: '10', groupId: '3', groupName: 'Kiln', managerAddress: ADDR_A }),
        makeOperator({ id: '11', groupId: '3', groupName: 'Kiln', managerAddress: ADDR_B }),
        makeOperator({ id: '12', managerAddress: ADDR_C }),
      ],
    } as PopupEvent);
  });
}

describe('App — Groups tab behavior', () => {
  let port: MockPort;
  beforeEach(() => { port = createMockPort(); });

  it('renders the grouped accordion when the Groups tab is active', async () => {
    await mountApp(port);
    seedCm(port);

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    // Group header for group 3 and the ungrouped bucket are both present.
    expect(screen.getByText('g·3')).toBeInTheDocument();
    expect(screen.getByText('No group')).toBeInTheDocument();
  });

  it('shows search + All/Favorites but no Pending pill on the Groups tab', async () => {
    await mountApp(port);
    seedCm(port);
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    expect(screen.getByPlaceholderText('Search #ID, address, label…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pending' })).toBeNull();
  });

  it('persists the Groups tab via set-active-tab on click', async () => {
    await mountApp(port);
    seedCm(port);

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'set-active-tab',
      tab: 'groups',
      origin: TEST_ORIGIN,
    });
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npm run test -- groups-tab`
Expected: PASS. If the `g·3` group-id tag assertion is brittle against `OperatorGroups` markup (it renders `g·{id}` only when the group has a name — see `OperatorGroups.tsx:176`), the seeded `groupName: 'Kiln'` guarantees it renders; keep the assertion.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm run test`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/popup/groups-tab.test.tsx
git commit -m "test(popup): cover Groups tab rendering, toolbar, and persistence"
```

---

## Self-Review Notes

- **Spec coverage:** tab visibility/order (T1 S6, anchor tests), CM-only + fallback (T1 S6, anchor tests), delete switcher machinery (T1 S3-S5), shared `SearchToolbar` + shared state + `showPending` (T1 S6), no-migration (Global Constraints; no code), tests (T1 S7 repair, T2 add). All covered.
- **Placeholders:** none — every code step carries full code or exact line refs.
- **Type consistency:** `SearchToolbar` prop names (`onSearch`, `onFilterGroup`, `onRefresh`, `searchInputRef`, `showPending`, `lastFetchedAt: number | null`) are used identically in the call site (T1 S6) and definition. `PopupTab` includes `'groups'` before any consumer references it.
- **Coupling note for the executor:** Task 1 must land atomically — the shared-layer deletions (Step 3) break `App.tsx` compilation until Step 6 is applied. Do not run typecheck between Steps 3 and 6; run it at Step 8.
