---
date: 2026-09-25
topic: gate-proofs
---

# Unused Gate Proofs on the Shared Tab

## What We're Building

Addresses holding an **unconsumed merkle proof** in a vetted/curated gate (CSM `icsGate`,
`idvtcGate`; CM `curatedGate*`) become a new kind of **attachment** in the address index.
They surface on the Shared tab (new **Gate** filter chip) and in the connected bar's
"Attached to" panel, selectable like any operator attachment.

## Why

QA needs addresses that can still join through a gate (or claim a gate curve) — today the
only way to find one is to dig through a merkle-tree JSON by hand and check `isConsumed`.

## Why Not a Dedicated Tab

Gate eligibility *is* an attachment ("address X → ICS gate, proof unused"). Folding it into
`buildAttachmentIndex` reuses the Shared tab's rows, selection, labels and module-switch, gives
the hover panel gate data for free, and makes an operator address that also holds an unused
proof (the `claimCurve` case) show up as shared naturally. No sixth tab — the bar already
overflows.

## Scope

- Unconsumed proofs only. Consumed leaves are not surfaced.
- Gate set per (module, chain) = `MODULE_CONFIG[...].contractAddresses` ∩
  (`icsGate`, `idvtcGate`, `CURATED_GATES`). `permissionlessGate` has no tree. CSM 0x02 has no
  gates today → no requests, empty result.
- No badge on the Operators tab (YAGNI — Shared + hover cover it).

## Data Layer (service worker)

`lib/background/client.ts` — `getClient`, `contractChainId`, `clearClientCache` moved out of
`operator-cache.ts` so both caches share one client pool.

`lib/background/gate-cache.ts`, per `CacheContext`:

1. `gatesFor(module, chain)` (in `lib/shared/gates.ts`) lists gate contract names + addresses.
   Anvil resolves via `forkedFrom`, as operators do.
2. One `multicall` (`allowFailure: true`) of `treeRoot`, `treeCid`, `curveId`, `isPaused` per
   gate. ABIs: `VettedGateAbi` / `CuratedGateAbi` from `@lidofinance/lido-csm-sdk/abi`.
3. Per gate, isolated: zero root → skip. Root equal to the stored tree's root → reuse leaves.
   Otherwise `fetchTree({ urls, root })` from `@lidofinance/lido-csm-sdk/common` — urls are
   IPFS gateways for the CID (`DEFAULT_IPFS_GATEWAYS` + `toCidV1Base32`, guarded by
   `isValidIpfsCid`) then `MERKLE_TREE_FALLBACKS[module][chain][gate]`. `fetchTree` verifies the
   root, so a stale GitHub copy is rejected. Same code path the widget uses.
4. One `multicall` of `isConsumed(address)` over the leaves; keep the unconsumed.
5. A failing gate (all URLs dead, multicall revert) is stored with `error` — the rest still land.

No `Consumed` event scan: `getLogs` from deployment needs ranges public RPCs cap.

Storage (`chrome.storage.local`):

```ts
type CachedGate = {
  gate: string;          // contract name: 'icsGate', 'curatedGatePTO'
  label: string;         // 'ICS', 'PTO' — derived from the contract name
  curveId: string;       // bigint serialized
  operatorType: string;  // getOperatorTypeByCurveId(...) ?? 'CC'
  paused: boolean;
  unconsumed: Address[];
  leafCount: number;
  error?: string;
};
type GateCacheEntry = { gates: CachedGate[]; lastFetchedAt: number };
```

- `gates_${module}_${chainId}` → `GateCacheEntry` (what the popup receives).
- `gate_tree_${chainId}_${gate}` → `{ root, leaves }` — kept separate so the popup payload stays
  small while refresh can skip the download when the root is unchanged.
- Stale after 30 min, like operators. A new on-chain root invalidates the tree implicitly.

Label: `icsGate` → `ICS`, `idvtcGate` → `IDVTC`, `curatedGatePTO` → `PTO`, `curatedGateIODCP`
→ `IODCP` — strip `curatedGate` / `Gate`, uppercase. Matches the type badges.

Protocol (mirrors operators):

- Commands `request-gates` / `refresh-gates` `{ chainId, moduleType }`.
- Events `gates-update { chainId, moduleType, gates, lastFetchedAt }`, `gates-loading`.
- Unsupported network / Anvil without a fork / module without gates → still reply
  (`gates-update` with `[]`, or `gates-loading: false`) so the popup never hangs.
- The context-resolution block of `request-operators` (Anvil fork detection, custom RPC,
  unsupported chain) is extracted into one helper shared by both commands.

## Attachment Model

```ts
type AttachmentBase = {
  moduleType: ModuleType;
  operatorType: string; curveId: string;
  typeLabel: string;   // 'CSM·ICS'
  kind: string;        // ribbon class suffix
};
type OperatorAttachment = AttachmentBase & {
  type: 'operator'; operatorId: string; primaryRole: AddressRole; pills: RoleEntry[];
};
type GateAttachment = AttachmentBase & {
  type: 'gate'; gate: string; gateLabel: string; paused: boolean;
};
type Attachment = OperatorAttachment | GateAttachment;
```

- Identity: gate attachment = (module, gate); operator = (module, id). `attachmentKey(att)` →
  `csm:op:7` / `csm:gate:icsGate` replaces hand-built React keys.
- Gate `typeLabel` = `${MODULE_SHORT}·${gateLabel}` (never `·CC`, even for an unknown curve);
  `kind` = `operatorKind(operatorType)`, so a gate row wears the ribbon of the operator type the
  address would become.
- `buildAttachmentIndex(byModule, gatesByModule = {})`: after operators, each unconsumed address
  of each non-error gate gets a `GateAttachment`, appended after its operator attachments.
  New entry flag `gate: boolean`. `pending` / `claimer` look at operator attachments only.
- `sharedAddresses(index, inModule)` keeps entries with `attachments.length > 1 || gate`, with at
  least one attachment (either type) in `inModule`.

## UI

**Filter chips:** All · Cross-module · Pending · Claimer · **Gate**.

- All / Cross-module / Pending / Claimer: unchanged semantics — `attachments.length > 1`
  (gates count toward it) plus their predicate.
- Gate: `entry.gate`, any count — the only view listing addresses that joined nothing yet.
  Hint: "Addresses with an unused gate proof — including ones not on any operator".
- `#N` search matches operator attachments only; `@type` also matches gate attachments (by
  `operatorType` or `gateLabel`); plain text also matches `gateLabel`.

**Gate row** (`AttachmentRow`, `type === 'gate'`): ribbon · `gate` in the id slot (dim mono,
where `#7` sits) · type badge `CSM·ICS` · spacer · one pill `PROOF` (hint "Unused proof in the
ICS gate tree") or dashed `PAUSED` (hint "Gate paused — proof unused, joining blocked"). No
label editor.

**Counts:** `countLabel` counts operators, then gate labels: `2 CSM · ICS`, `ICS · PTO`.
`countHint`: "Attached to 2 CSM operators · unused ICS proof." Hover trigger: `2 ops · ICS`,
or `ICS` alone.

**Selection:** `AddressSource` gains `{ type: 'gate'; gate: string }` — click provenance only,
like `operatorId`. `onSelect` callbacks on Shared / AttachedOperators take the `Attachment`;
`App` builds the source from it and adds `moduleType` when it differs from the site's.

**Loading:** `useSharedAddresses` also requests gates for every wanted module when enabled.
Gates never hold the operator loading state — the index rebuilds when `gates-update` arrives.
`gatesLoading` is exposed separately:

- Gate chip + gates loading + nothing yet → spinner "Loading gate trees…".
- Gate chip + nothing → empty state "No unused gate proofs".
- Any gate with `error` → a small `⚠` by the staleness label, hint listing the failed gates.
- Refresh also sends `refresh-gates`.

The connected bar's hover needs no change beyond the new row variant and trigger label — it
already reads the index.

## Testing

- `test/background/gate-cache.test.ts`: zero root skipped; unchanged root skips `fetchTree`;
  consumed filtered out; one gate failing leaves others intact; Anvil uses `forkedFrom`
  addresses; module without gates → no RPC.
- `test/background/request-gates.test.ts`: mirrors `request-operators.test.ts`, including the
  always-reply paths.
- `test/popup/attachments.test.ts`: gate attachments, `attachmentKey`, `gate` flag, pending /
  claimer ignore gates, counts and hints, module scoping with a gate-only entry.
- `filterSharedAddresses`: Gate vs All semantics, `#N` / `@ics` / text search.
- `use-shared-addresses`: gates arrive after operators without re-entering loading.
- Components: gate `AttachmentRow`, Gate chip empty / loading states, hover trigger label,
  gate selection sends `{ type: 'gate' }` source with `moduleType`.
- E2E: seed `gates_csm_560048` fresh via `sw.evaluate` (new `seedGates` helper), Shared → Gate
  → select → connected bar shows the address and its hover lists the gate row (scoped to the
  card — `.attach-row` is not unique).

## Docs

CLAUDE.md gotchas: gates are attachments (identity (module, gate)); gate cache split into
popup entry + root-keyed tree; unused-only; Gate chip is not a subset of All.
