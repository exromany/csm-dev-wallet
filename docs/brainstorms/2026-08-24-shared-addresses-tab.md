---
date: 2026-08-24
topic: shared-addresses-tab
---

# Shared Addresses Tab

## What We're Building

A fourth browsing tab, **Shared**, listing addresses that are attached to more than one
operator — spanning **both** modules (CSM and CM) rather than only the one the site is
currently scoped to. Each row is an address; expanding it shows one row per attachment
(operator + module + the roles that address holds there), and each attachment can be
selected as the connected account.

Design canvas (four explored directions, three rejected):
<https://claude.ai/code/artifact/47c62007-b679-4066-95cf-6f9f0f4c7b4f>

## Why

The data model is operator-first. `CachedOperator` holds `managerAddress` / `rewardsAddress`
plus the proposed pair, and `groupAddresses()` in `OperatorList.tsx` de-duplicates roles
*within a single operator*. There is no reverse index, so an address that manages operators
#12, #57 and #7 renders as three unrelated rows with nothing signalling they are the same
account.

For QA that matters twice over:

- A multi-operator address is a **more interesting fixture**, not a curiosity — it is how you
  reach the widget's multi-operator account view. Today you can only find one by accident.
- Cross-module sharing is invisible by construction. `moduleType` is site-level scope and the
  operator cache is keyed per `(chainId, moduleType)`, so no existing surface can see both.

## Why Its Own Tab

Every existing browsing surface is module-scoped by construction, so a CSM+CM list cannot
honestly live inside one. That is the whole argument for a peer surface: **Shared** is the only
tab that is not module-scoped.

Rejected alternatives, with the reason each was dropped:

| Direction | Why not |
| --- | --- |
| Count badge on the address chip + drill-down popover | Discovery only — you cannot browse shared addresses, you have to happen upon one. **Worth shipping later as a companion**: it is the in-place hook where Shared is the browsable surface. |
| `Ops` / `Addr` view toggle inside the Operators tab | The tab is module-scoped, so an address holding four roles across both modules reads as "2 CM". Also lists every address, so mostly noise, and the All/Favorites/Pending chips stop meaning anything. |
| Promote a synthesized address card when search matches one | Invisible until you search, and you must already know the address. Answers "what else is this attached to" but never "which addresses are shared". |

## Naming

**Shared.** Same construction as the existing tabs: `Manual` means *manual addresses* and
`Anvil` means *anvil accounts*, so `Shared` means *shared addresses*. Rejected `Multi` and
`Cross` as adjective fragments that omit *multi-what*, and `Addresses` because it is the widest
label and the tab bar has no room (below).

The name also settles the contents: only addresses with **more than one** attachment belong
here. Single-attachment addresses are already covered by Operators.

## Behaviour

### Rows

One row per shared address, sorted by attachment count descending, then by address.

Collapsed, the row shows: caret, truncated address, its `addressLabels` entry if any, a count
pill, copy button. The count pill reads `2 CSM · 1 CM` when the address spans modules (tinted
`--warn`) or `2 CM` when it does not (default `--surface-2` treatment).

Expanded, one row per attachment: type-coloured ribbon, `#<id>`, a `CSM·DEF`-style module+type
tag, the role pills that address holds on that operator, and a select button. The currently
connected attachment shows `in use` instead.

_Dropped during implementation: the extension only knows the connected address, not the operator
the dapp/widget actually resolves it to, so attachment-level "in use" was unsound — every row
stayed selectable, and only the address-level connected marker on the card shipped._

### Module+type tag

`OperatorRow` strips the module prefix (`operatorType.replace(/^CSM_|^CM_/, '')` → `DEF`). In a
cross-module list that prefix has to come back, because ribbon hue is otherwise the only module
signal. Attachments render `CSM·DEF` / `CM·PO`, and the `CC` fallback (no prefix in the raw
value) renders as `CSM·CC` / `CM·CC` from the module it was cached under.

### Filters

`All · Cross-module · Pending`, reusing the existing `.filter-btn` chips.

- **All** — every shared address.
- **Cross-module** — attachments in both CSM and CM.
- **Pending** — has at least one proposed role. This mirrors the existing Operators `Pending`
  scope (`filterByGroup`), reading here as "addresses caught up in a proposed role change".

There is deliberately no `Shared` chip — the tab is that filter. There is no `Favorites` chip
either: favourites are scoped to operator and group ids (`"csm:1:42"`), and an address-level
favourite would be a new concept. Out of scope.

### A proposed role is an attachment

`P-MGR` / `P-RWD` count. The app already treats proposed roles as first-class (a dedicated
`Pending` filter and a dashed `.role-pill`), so an address proposed as manager on an operator is
attached to it. This is what makes the `Pending` filter meaningful, and it is easy to get wrong:
an index that only walks `managerAddress` / `rewardsAddress` under-counts silently.

### Operator identity is (id, module)

CSM #7 and CM #7 are different operators. Every comparison — "is this the connected
attachment", de-duplication, keying — must use the pair, never the id alone.

### Selecting a cross-module attachment switches the module

`AddressSource` attributes a selection to one `operatorId`, and the site's `moduleType` must
agree with it, or the Operators tab would show a different module than the connected account
came from. So `select-address` gains an optional `moduleType`, applied in the *same*
`setSiteState` call as the address — one atomic write, one broadcast, no ordering hazard between
two commands.

The select button says so: `use` for an attachment in the current module, `use in CSM` when
taking it will move the site.

### Both caches, and what happens when one is cold

The index needs operators from both modules. The existing `request-operators` command already
takes an arbitrary `moduleType` and `triggerRefresh` broadcasts `operators-update` tagged with
`chainId` + `moduleType`, so the Shared tab asks for **both** modules and listens for both. No
protocol addition, and cold/stale caches fetch through exactly the same path as the Operators
tab, with the same `operators-loading` events driving the spinner.

Degradation rules:

- A module whose cache has not arrived yet is simply absent from the index. The tab shows the
  existing spinner while any requested module is still loading, so counts are never displayed
  half-built.
- **CM not deployed on this network** (a known gotcha — `useModuleAvailability` reports it and
  `App.tsx` already auto-switches away from CM): request CSM only, and note in the tab that CM
  is unavailable, rather than implying every address is CSM-only.

### Tab budget

The bar has no room for a sixth tab. Measured at 12px/500 Inter with the existing `10px` tab
padding, inside the `400px` popup's `372px` of usable width:

| | Operators | Groups | Shared | Manual | Anvil | Settings | gaps | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| With Settings as a tab | 78 | 63 | 66 | 63 | 51 | 68 | 10 | **399** |
| Settings in the header | 78 | 63 | 66 | 63 | 51 | — | 8 | **329** |

So **Settings moves to a header `icon-btn`**, next to the existing theme toggle — the vocabulary
is already there. `Shared` at 66px is what makes 329 comfortable; `Addresses` at 82px would have
cost the margin.

## Out of Scope

- Address-level favourites.
- The in-place count badge on operator-row chips (the rejected direction B) — a good follow-up,
  not part of this.
- Any change to how operators are fetched, cached or grouped.
- Signing behaviour. A shared address is watch-only exactly like any other operator address.

## Acceptance

- A Shared tab lists only addresses with >1 attachment, both modules included, and never shows
  a single-attachment address.
- An address holding roles on CSM #12, CSM #57, CM #7 and CM #44 (proposed) shows a count of
  `2 CSM · 2 CM` and four attachment rows.
- `Cross-module` hides same-module-only addresses; `Pending` shows only addresses with a
  proposed role.
- Selecting a CM attachment while the site is on CSM connects that address *and* leaves the site
  on CM, in one state update.
- With CM unavailable, the tab still works from CSM alone and says CM is unavailable.
- The tab bar fits, with Settings reachable from the header.
