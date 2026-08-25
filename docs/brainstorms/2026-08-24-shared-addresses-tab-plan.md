# Shared Addresses Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Shared` tab to the popup listing addresses attached to more than one operator across both CSM and CM, where each attachment can be selected as the connected account.

**Architecture:** A pure reverse-index module in `lib/shared/attachments.ts` turns per-module `CachedOperator[]` into `address → attachments`. The popup asks the service worker for **both** modules' operators using the existing `request-operators` command (it already accepts an arbitrary `moduleType`, and `operators-update` events are already tagged with `chainId` + `moduleType`), so no new message type is needed. Selecting a cross-module attachment extends `select-address` with an optional `moduleType` so address and module land in one atomic `setSiteState`. `Settings` moves from the tab bar to a header icon button to make room.

**Tech Stack:** TypeScript (strict, `.js` import extensions), React, WXT (Manifest V3), vitest + @testing-library/react, Playwright for e2e, oxlint.

**Spec:** `docs/brainstorms/2026-08-24-shared-addresses-tab.md`

## Global Constraints

- Use `.js` extensions in TypeScript imports (ESM resolution via WXT).
- `chrome.storage` cannot hold BigInts — operator `id` and `curveId` are strings throughout. Never convert them in this feature.
- Operator identity is the pair `(operatorId, moduleType)`. CSM #7 and CM #7 are different operators; never compare ids alone.
- A proposed role (`P-MGR` / `P-RWD`) **is** an attachment.
- Tests live under `test/popup/` (this is where `lib/shared/` modules are tested too — see `test/popup/favorites.test.ts`, `test/popup/grouped-view.test.ts`). Tests are excluded from `tsconfig`, so they are not type-checked.
- Test fixtures come from `test/fixtures.ts` (`makeOperator`, `makeState`, `ADDR_A/B/C`).
- This repo signs commits with the on-disk key (see `CLAUDE.local.md`) — plain `git commit` signs. Never pass `--no-gpg-sign`.
- Run `pnpm run lint && pnpm run typecheck && pnpm run test` before each commit.
- Do not add Claude as a commit co-author.

---

## File Structure

**Create:**
- `lib/shared/attachments.ts` — the reverse index and its display helpers. Pure, no Chrome or React deps. One responsibility: turning operators into address-keyed attachments.
- `entrypoints/popup/SharedAddresses.tsx` — the tab: own search/filter toolbar, address cards, attachment rows.
- `test/popup/attachments.test.ts` — unit tests for the index.
- `test/popup/shared-addresses.test.tsx` — component tests for the tab.
- `test/popup/use-shared-addresses.test.ts` — hook tests (port request/response wiring).
- `test/e2e/shared-addresses.e2e.ts` — end-to-end, including the cross-module module switch (the command handler lives inside `defineBackground`'s closure and is not exported, so this is the only place it can be exercised).

**Modify:**
- `lib/shared/types.ts` — add `'shared'` to `PopupTab`.
- `lib/shared/messages.ts` — add optional `moduleType` to the `select-address` command.
- `entrypoints/background.ts` — apply that `moduleType` inside the existing `select-address` case.
- `lib/popup/hooks.ts` — add `useSharedAddresses` and `filterSharedAddresses`.
- `entrypoints/popup/OperatorList.tsx` — rebuild `groupAddresses` on the new shared `roleEntries()`, and import `operatorKind` instead of the local `typeKind`. Behaviour unchanged; `test/popup/operator-list.test.tsx` is the regression gate.
- `entrypoints/popup/App.tsx` — add the tab, move Settings to a header icon button.
- `entrypoints/popup/style.css` — make the `kind-*` ribbon-colour classes usable outside `.operator-row`, add the address-card and attachment-row rules.
- `test/fixtures.ts` — add `ADDR_D` (a fourth address is needed to express a four-attachment case).
- `CLAUDE.md` — File Structure and Gotchas entries.

Nothing in `lib/background/operator-cache.ts`, `state.ts`, `rpc-handler.ts`, `anvil.ts`, the content script or the inpage provider changes.

---

## Task 1: Extract `roleEntries()` and rebuild `groupAddresses` on it

The index and the existing operator row need the same thing: an operator's four (role, address) slots with owner and proposed flags. Extract it once so the two cannot drift.

**Files:**
- Create: `lib/shared/attachments.ts`
- Create: `test/popup/attachments.test.ts`
- Modify: `entrypoints/popup/OperatorList.tsx` (replace `groupAddresses` body at lines 148-197, replace `typeKind` at lines 200-202)

**Interfaces:**
- Consumes: `CachedOperator`, `AddressRole` from `lib/shared/types.js`
- Produces: `RoleLabel`, `RoleEntry`, `roleEntries(op)`, `operatorKind(operatorType)`

- [ ] **Step 1: Write the failing test**

```ts
// test/popup/attachments.test.ts
import { describe, it, expect } from 'vitest';
import { roleEntries, operatorKind } from '../../lib/shared/attachments.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';

describe('roleEntries', () => {
  it('returns manager and rewards, marking whichever is owner', () => {
    const op = makeOperator({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_B,
      ownerAddress: ADDR_A,
    });

    const entries = roleEntries(op);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      role: 'manager', label: 'MGR', tint: 'mgr', address: ADDR_A, proposed: false, owner: true,
    });
    expect(entries[1]).toMatchObject({
      role: 'rewards', label: 'RWD', tint: 'rwd', address: ADDR_B, proposed: false, owner: false,
    });
  });

  it('marks the rewards address as owner when it holds extended permissions', () => {
    const op = makeOperator({ id: '2', ownerAddress: ADDR_B, extendedManagerPermissions: false });
    const entries = roleEntries(op);
    expect(entries.find((e) => e.role === 'manager')?.owner).toBe(false);
    expect(entries.find((e) => e.role === 'rewards')?.owner).toBe(true);
  });

  it('appends proposed roles, never marking them owner', () => {
    const op = makeOperator({ id: '3', proposedManagerAddress: ADDR_C });
    const entries = roleEntries(op);
    expect(entries.map((e) => e.label)).toEqual(['MGR', 'RWD', 'P-MGR']);
    expect(entries[2]).toMatchObject({
      role: 'proposedManager', tint: 'mgr', address: ADDR_C, proposed: true, owner: false,
    });
  });

  it('omits proposed roles that are unset', () => {
    expect(roleEntries(makeOperator({ id: '4' })).some((e) => e.proposed)).toBe(false);
  });

  it('collapses both proposed roles when both are set', () => {
    const op = makeOperator({
      id: '5', proposedManagerAddress: ADDR_C, proposedRewardsAddress: ADDR_C,
    });
    expect(roleEntries(op).map((e) => e.label)).toEqual(['MGR', 'RWD', 'P-MGR', 'P-RWD']);
  });
});

describe('operatorKind', () => {
  it('lowercases and dashes the raw operator type', () => {
    expect(operatorKind('CSM_DEF')).toBe('csm-def');
    expect(operatorKind('CM_PO')).toBe('cm-po');
  });

  it('falls back to cc for an empty type', () => {
    expect(operatorKind('')).toBe('cc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/popup/attachments.test.ts`
Expected: FAIL — cannot resolve `lib/shared/attachments.js`

- [ ] **Step 3: Write the implementation**

```ts
// lib/shared/attachments.ts
import type { Address } from 'viem';
import type { AddressRole, CachedOperator } from './types.js';

export type RoleLabel = 'MGR' | 'RWD' | 'P-MGR' | 'P-RWD';

export type RoleEntry = {
  role: AddressRole;
  label: RoleLabel;
  tint: 'mgr' | 'rwd';
  address: Address;
  proposed: boolean;
  owner: boolean;
};

/** The (role, address) slots an operator holds — unset proposed roles omitted. */
export function roleEntries(op: CachedOperator): RoleEntry[] {
  const ownerKey = op.ownerAddress.toLowerCase();
  const entries: RoleEntry[] = [
    {
      role: 'manager', label: 'MGR', tint: 'mgr', address: op.managerAddress,
      proposed: false, owner: op.managerAddress.toLowerCase() === ownerKey,
    },
    {
      role: 'rewards', label: 'RWD', tint: 'rwd', address: op.rewardsAddress,
      proposed: false, owner: op.rewardsAddress.toLowerCase() === ownerKey,
    },
  ];
  if (op.proposedManagerAddress) {
    entries.push({
      role: 'proposedManager', label: 'P-MGR', tint: 'mgr',
      address: op.proposedManagerAddress, proposed: true, owner: false,
    });
  }
  if (op.proposedRewardsAddress) {
    entries.push({
      role: 'proposedRewards', label: 'P-RWD', tint: 'rwd',
      address: op.proposedRewardsAddress, proposed: true, owner: false,
    });
  }
  return entries;
}

/** 'CSM_LEA' → 'csm-lea' — drives per-type ribbon colour via CSS class. */
export function operatorKind(operatorType: string): string {
  return (operatorType || 'cc').toLowerCase().replace(/_/g, '-');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/popup/attachments.test.ts`
Expected: PASS

- [ ] **Step 5: Rebuild `groupAddresses` on `roleEntries`**

In `entrypoints/popup/OperatorList.tsx`, add to the imports at the top:

```ts
import { roleEntries, operatorKind } from '../../lib/shared/attachments.js';
```

Replace the whole `groupAddresses` function (the `type Entry = {...}` block and everything through its closing brace) with:

```ts
function groupAddresses(op: CachedOperator): AddressGroup[] {
  const map = new Map<string, AddressGroup>();
  for (const e of roleEntries(op)) {
    const key = e.address.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { address: e.address, primaryRole: e.role, rolePills: [], proposedPills: [] };
      map.set(key, group);
    }
    if (e.proposed) {
      group.proposedPills.push(e.label);
    } else {
      group.rolePills.push({ label: e.label as 'MGR' | 'RWD', tint: e.tint, owner: e.owner });
    }
  }
  return Array.from(map.values());
}
```

Then delete the local `typeKind` function entirely (including its comment) and change its one call site in `OperatorRow` from `typeKind(op.operatorType)` to `operatorKind(op.operatorType)`.

- [ ] **Step 6: Run the full suite to verify nothing regressed**

Run: `pnpm run test`
Expected: PASS — `test/popup/operator-list.test.tsx` is the gate here; the rendered row markup must be byte-identical.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck
git add lib/shared/attachments.ts test/popup/attachments.test.ts entrypoints/popup/OperatorList.tsx
git commit -m "refactor: extract roleEntries/operatorKind into lib/shared/attachments"
```

---

## Task 2: Build the address → attachments reverse index

**Files:**
- Modify: `lib/shared/attachments.ts` (append)
- Modify: `test/fixtures.ts` (add `ADDR_D`)
- Modify: `test/popup/attachments.test.ts` (append)

**Interfaces:**
- Consumes: `roleEntries`, `operatorKind` from Task 1
- Produces: `Attachment`, `AddressAttachments`, `attachmentTypeLabel(moduleType, operatorType)`, `buildAttachmentIndex(byModule)`, `sharedAddresses(index)`, `moduleCounts(entry)`, `countLabel(entry)`

- [ ] **Step 1: Add the fourth address fixture**

In `test/fixtures.ts`, after the `ADDR_C` line:

```ts
export const ADDR_D = '0xDdDdddDdDDdDDDDdDdDdDDdDDdDdDDDdDddDdDDD' as const;
```

- [ ] **Step 2: Write the failing test**

Append to `test/popup/attachments.test.ts`:

```ts
import {
  attachmentTypeLabel,
  buildAttachmentIndex,
  sharedAddresses,
  moduleCounts,
  countLabel,
} from '../../lib/shared/attachments.js';
import { ADDR_D } from '../fixtures.js';

describe('attachmentTypeLabel', () => {
  it('restores the module prefix that OperatorRow strips', () => {
    expect(attachmentTypeLabel('csm', 'CSM_DEF')).toBe('CSM·DEF');
    expect(attachmentTypeLabel('cm', 'CM_PO')).toBe('CM·PO');
  });

  it('qualifies the prefixless CC fallback with its cache module', () => {
    expect(attachmentTypeLabel('cm', 'CC')).toBe('CM·CC');
    expect(attachmentTypeLabel('csm', '')).toBe('CSM·CC');
  });
});

describe('buildAttachmentIndex', () => {
  it('collapses several roles on one operator into a single attachment', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '31', managerAddress: ADDR_A, rewardsAddress: ADDR_A, ownerAddress: ADDR_A })],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.attachments).toHaveLength(1);
    expect(entry?.attachments[0].pills.map((p) => p.label)).toEqual(['MGR', 'RWD']);
    expect(entry?.attachments[0].primaryRole).toBe('manager');
  });

  it('keeps CSM #7 and CM #7 as separate attachments', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CSM_DEF' })],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.attachments).toHaveLength(2);
    expect(entry?.attachments.map((a) => a.moduleType)).toEqual(['csm', 'cm']);
    expect(entry?.attachments.map((a) => a.typeLabel)).toEqual(['CSM·DEF', 'CM·PO']);
    expect(entry?.crossModule).toBe(true);
    expect(entry?.modules).toEqual(['csm', 'cm']);
  });

  it('counts a proposed role as an attachment and flags the address pending', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A })],
      cm: [makeOperator({ id: '44', managerAddress: ADDR_B, rewardsAddress: ADDR_C, proposedManagerAddress: ADDR_A, operatorType: 'CM_EEO' })],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.attachments).toHaveLength(2);
    expect(entry?.pending).toBe(true);
    expect(entry?.attachments[1].pills[0].label).toBe('P-MGR');
    expect(entry?.attachments[1].primaryRole).toBe('proposedManager');
  });

  it('leaves same-module addresses not cross-module and not pending', () => {
    const index = buildAttachmentIndex({
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '23', managerAddress: ADDR_A, operatorType: 'CM_PGO' }),
      ],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.crossModule).toBe(false);
    expect(entry?.pending).toBe(false);
    expect(entry?.modules).toEqual(['cm']);
  });

  it('carries the ribbon kind for each attachment', () => {
    const index = buildAttachmentIndex({ csm: [makeOperator({ id: '42', managerAddress: ADDR_A, operatorType: 'CSM_LEA' })] });
    expect(index.get(ADDR_A.toLowerCase())?.attachments[0].kind).toBe('csm-lea');
  });
});

describe('sharedAddresses', () => {
  const index = buildAttachmentIndex({
    csm: [
      makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_D, ownerAddress: ADDR_A }),
      makeOperator({ id: '57', managerAddress: ADDR_D, rewardsAddress: ADDR_A, ownerAddress: ADDR_D }),
    ],
    cm: [
      makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_A, operatorType: 'CM_PO' }),
      makeOperator({ id: '31', managerAddress: ADDR_C, rewardsAddress: ADDR_C, ownerAddress: ADDR_C, operatorType: 'CM_DO' }),
    ],
  });

  it('drops addresses attached to only one operator', () => {
    const list = sharedAddresses(index);
    const addresses = list.map((e) => e.address.toLowerCase());
    expect(addresses).not.toContain(ADDR_B.toLowerCase());
    expect(addresses).not.toContain(ADDR_C.toLowerCase());
  });

  it('sorts by attachment count descending', () => {
    const list = sharedAddresses(index);
    expect(list[0].address.toLowerCase()).toBe(ADDR_A.toLowerCase());
    expect(list[0].attachments).toHaveLength(3);
    expect(list[1].attachments).toHaveLength(2);
  });
});

describe('countLabel', () => {
  it('names both modules when the address spans them', () => {
    const index = buildAttachmentIndex({
      csm: [
        makeOperator({ id: '12', managerAddress: ADDR_A }),
        makeOperator({ id: '57', managerAddress: ADDR_A, operatorType: 'CSM_ICS' }),
      ],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });
    const entry = index.get(ADDR_A.toLowerCase())!;
    expect(moduleCounts(entry)).toEqual({ csm: 2, cm: 1 });
    expect(countLabel(entry)).toBe('2 CSM · 1 CM');
  });

  it('names one module when the address does not span', () => {
    const index = buildAttachmentIndex({
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '23', managerAddress: ADDR_A, operatorType: 'CM_PGO' }),
      ],
    });
    expect(countLabel(index.get(ADDR_A.toLowerCase())!)).toBe('2 CM');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run test/popup/attachments.test.ts`
Expected: FAIL — `buildAttachmentIndex is not a function`

- [ ] **Step 4: Write the implementation**

Append to `lib/shared/attachments.ts`:

```ts
import type { ModuleType } from './types.js';

/** One operator an address is attached to, with every role it holds there. */
export type Attachment = {
  moduleType: ModuleType;
  operatorId: string;
  operatorType: string; // raw, e.g. 'CSM_DEF' or the 'CC' fallback
  typeLabel: string;    // 'CSM·DEF' — module prefix restored for cross-module display
  kind: string;         // 'csm-def' — ribbon colour class suffix
  primaryRole: AddressRole; // role to attribute a selection to
  pills: RoleEntry[];
};

export type AddressAttachments = {
  address: Address;
  attachments: Attachment[];
  modules: ModuleType[];
  crossModule: boolean;
  pending: boolean; // holds at least one proposed role
};

const MODULE_ORDER: ModuleType[] = ['csm', 'cm'];

/** 'CSM_DEF' → 'CSM·DEF'. The prefixless 'CC' fallback takes its cache module. */
export function attachmentTypeLabel(moduleType: ModuleType, operatorType: string): string {
  const bare = (operatorType || 'CC').replace(/^CSM_|^CM_/, '');
  return `${moduleType.toUpperCase()}·${bare}`;
}

/**
 * Reverse index over one or both module caches: lowercased address → attachments.
 * Roles of the same address on the same operator collapse into one attachment;
 * the same operator id in different modules stays two.
 */
export function buildAttachmentIndex(
  byModule: Partial<Record<ModuleType, CachedOperator[]>>,
): Map<string, AddressAttachments> {
  const index = new Map<string, AddressAttachments>();

  for (const moduleType of MODULE_ORDER) {
    for (const op of byModule[moduleType] ?? []) {
      const perAddress = new Map<string, Attachment>();
      for (const e of roleEntries(op)) {
        const key = e.address.toLowerCase();
        let att = perAddress.get(key);
        if (!att) {
          att = {
            moduleType,
            operatorId: op.id,
            operatorType: op.operatorType,
            typeLabel: attachmentTypeLabel(moduleType, op.operatorType),
            kind: operatorKind(op.operatorType),
            primaryRole: e.role,
            pills: [],
          };
          perAddress.set(key, att);
        }
        att.pills.push(e);
      }

      for (const [key, att] of perAddress) {
        let entry = index.get(key);
        if (!entry) {
          entry = {
            address: att.pills[0].address,
            attachments: [],
            modules: [],
            crossModule: false,
            pending: false,
          };
          index.set(key, entry);
        }
        entry.attachments.push(att);
      }
    }
  }

  for (const entry of index.values()) {
    entry.modules = MODULE_ORDER.filter((m) => entry.attachments.some((a) => a.moduleType === m));
    entry.crossModule = entry.modules.length > 1;
    entry.pending = entry.attachments.some((a) => a.pills.some((p) => p.proposed));
  }

  return index;
}

/** Addresses held by more than one operator — most attachments first. */
export function sharedAddresses(index: Map<string, AddressAttachments>): AddressAttachments[] {
  return [...index.values()]
    .filter((e) => e.attachments.length > 1)
    .sort(
      (a, b) =>
        b.attachments.length - a.attachments.length ||
        a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );
}

export function moduleCounts(entry: AddressAttachments): { csm: number; cm: number } {
  let csm = 0;
  for (const a of entry.attachments) if (a.moduleType === 'csm') csm++;
  return { csm, cm: entry.attachments.length - csm };
}

/** '2 CSM · 1 CM' when the address spans modules, '2 CM' when it does not. */
export function countLabel(entry: AddressAttachments): string {
  const { csm, cm } = moduleCounts(entry);
  if (csm && cm) return `${csm} CSM · ${cm} CM`;
  return csm ? `${csm} CSM` : `${cm} CM`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/popup/attachments.test.ts`
Expected: PASS

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
git add lib/shared/attachments.ts test/popup/attachments.test.ts test/fixtures.ts
git commit -m "feat: add address-to-attachments reverse index over both module caches"
```

---

## Task 3: Protocol — the `shared` tab value and a module-switching selection

**Files:**
- Modify: `lib/shared/types.ts:50-52` (`PopupTab`)
- Modify: `lib/shared/messages.ts:44` (`select-address` command)
- Modify: `entrypoints/background.ts` (the `select-address` case)

**Interfaces:**
- Produces: `PopupTab` including `'shared'`; `select-address` accepting `moduleType?: ModuleType`

There is no unit test here: `handlePopupCommand` lives inside `defineBackground`'s closure and is not exported, so the behaviour is pinned by the e2e test in Task 7. Keep this task to the mechanical change.

- [ ] **Step 1: Widen `PopupTab`**

In `lib/shared/types.ts`, replace the `PopupTab` declaration:

```ts
// Persistable popup tabs. Settings is deliberately excluded — it's a transient
// destination we never want to land on when the popup reopens.
export type PopupTab = 'operators' | 'groups' | 'shared' | 'manual' | 'anvil';
```

No storage migration is needed: `getSiteState` spreads `DEFAULT_SITE_STATE` over stored state, and `activeTab` keeps whatever legacy value it had.

- [ ] **Step 2: Extend the `select-address` command**

In `lib/shared/messages.ts`, replace the `select-address` line in `PopupCommand`:

```ts
  // `moduleType` is set when the pick comes from the Shared tab and belongs to the
  // other module — address and module must land in one write, or the Operators tab
  // would show a different module than the connected account came from.
  | { type: 'select-address'; origin: string; address: string; source: import('./types.js').AddressSource; moduleType?: ModuleType }
```

- [ ] **Step 3: Apply it atomically in the background**

In `entrypoints/background.ts`, in the `case 'select-address':` block, replace the `setSiteState` call:

```ts
        await setSiteState(origin, {
          selectedAddress: {
            address: command.address,
            source: command.source,
          },
          isConnected: true,
          ...(command.moduleType ? { moduleType: command.moduleType } : {}),
        });
```

Everything else in the case (the state broadcast, `notifyAccountsChanged`, the pending-connection resolution) is unchanged.

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm run lint && pnpm run typecheck && pnpm run test`
Expected: PASS. `test/popup/app-active-tab.test.tsx` exercises tab persistence and must still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/shared/types.ts lib/shared/messages.ts entrypoints/background.ts
git commit -m "feat: allow select-address to switch module atomically"
```

---

## Task 4: `useSharedAddresses` hook and its search/scope filter

The hook asks the service worker for **both** modules using the existing `request-operators`
command, keeps the two operator lists apart, and derives the index from them.

**Files:**
- Modify: `lib/popup/hooks.ts` (append after `useOperators`, and export the filter alongside `filterOperators`)
- Create: `test/popup/use-shared-addresses.test.ts`

**Interfaces:**
- Consumes: `buildAttachmentIndex`, `sharedAddresses`, `AddressAttachments` from Task 2
- Produces: `SharedFilter` (`'all' | 'cross' | 'pending'`), `filterSharedAddresses(list, search, filter, addressLabels)`, `useSharedAddresses(port, origin, chainId, cmAvailable)` returning `{ addresses, loading, lastFetchedAt, cmMissing, refresh }`

- [ ] **Step 1: Write the failing test**

```ts
// test/popup/use-shared-addresses.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSharedAddresses, filterSharedAddresses } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';
import type { PopupEvent, PopupCommand } from '../../lib/shared/messages.js';
import { buildAttachmentIndex, sharedAddresses } from '../../lib/shared/attachments.js';

const TEST_ORIGIN = 'https://example.com';

describe('useSharedAddresses', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  const render = (cmAvailable: boolean | undefined = undefined) =>
    renderHook(() =>
      useSharedAddresses(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, cmAvailable),
    );

  it('requests operators for both modules', () => {
    render();
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'cm']);
  });

  it('requests CSM only when CM is unavailable, and reports it', () => {
    const { result } = render(false);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm']);
    expect(result.current.cmMissing).toBe(true);
  });

  it('stays loading until every requested module has answered', () => {
    const { result } = render();
    expect(result.current.loading).toBe(true);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(true);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(false);
  });

  it('indexes across both modules and reports the stalest fetch time', () => {
    const { result } = render();

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });

    expect(result.current.addresses).toHaveLength(1);
    expect(result.current.addresses[0].address.toLowerCase()).toBe(ADDR_A.toLowerCase());
    expect(result.current.addresses[0].crossModule).toBe(true);
    expect(result.current.lastFetchedAt).toBe(1000);
  });

  it('ignores events for a different chain', () => {
    const { result } = render();
    act(() => {
      port._emit({
        type: 'operators-update', chainId: 560048, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
    });
    expect(result.current.addresses).toEqual([]);
  });
});

describe('filterSharedAddresses', () => {
  const list = sharedAddresses(
    buildAttachmentIndex({
      csm: [
        makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_A }),
        makeOperator({ id: '57', managerAddress: ADDR_B, rewardsAddress: ADDR_C, ownerAddress: ADDR_B }),
      ],
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, ownerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '44', managerAddress: ADDR_C, rewardsAddress: ADDR_B, ownerAddress: ADDR_C, proposedManagerAddress: ADDR_B, operatorType: 'CM_EEO' }),
      ],
    }),
  );

  it('passes everything through on the all scope', () => {
    expect(filterSharedAddresses(list, '', 'all')).toHaveLength(list.length);
  });

  it('keeps only cross-module addresses on the cross scope', () => {
    const out = filterSharedAddresses(list, '', 'cross');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => e.crossModule)).toBe(true);
  });

  it('keeps only addresses holding a proposed role on the pending scope', () => {
    const out = filterSharedAddresses(list, '', 'pending');
    expect(out).toHaveLength(1);
    expect(out[0].address.toLowerCase()).toBe(ADDR_B.toLowerCase());
  });

  it('matches an address substring', () => {
    const out = filterSharedAddresses(list, ADDR_A.slice(0, 8), 'all');
    expect(out).toHaveLength(1);
    expect(out[0].address.toLowerCase()).toBe(ADDR_A.toLowerCase());
  });

  it('matches an address label', () => {
    const labels = { [ADDR_C.toLowerCase()]: 'ops treasury' };
    const out = filterSharedAddresses(list, 'treasury', 'all', labels);
    expect(out).toHaveLength(1);
    expect(out[0].address.toLowerCase()).toBe(ADDR_C.toLowerCase());
  });

  it('matches an exact operator id with #', () => {
    const out = filterSharedAddresses(list, '#44', 'all');
    expect(out.every((e) => e.attachments.some((a) => a.operatorId === '44'))).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/popup/use-shared-addresses.test.ts`
Expected: FAIL — `useSharedAddresses is not a function`

- [ ] **Step 3: Write the implementation**

In `lib/popup/hooks.ts`, add to the existing imports at the top of the file:

```ts
import {
  buildAttachmentIndex,
  sharedAddresses,
  type AddressAttachments,
} from '../shared/attachments.js';
```

Append after the `useOperators` hook:

```ts
// ── useSharedAddresses ──

export type SharedFilter = 'all' | 'cross' | 'pending';

const SHARED_MODULES: ModuleType[] = ['csm', 'cm'];

/**
 * Addresses attached to more than one operator, across BOTH modules.
 *
 * Reuses `request-operators` (which already takes an arbitrary moduleType) rather
 * than adding a protocol message, so cold and stale caches fetch through exactly
 * the same path as the Operators tab.
 */
export function useSharedAddresses(
  port: chrome.runtime.Port | null,
  origin: string | null,
  chainId: number,
  cmAvailable: boolean | undefined,
) {
  const [byModule, setByModule] = useState<Partial<Record<ModuleType, CachedOperator[]>>>({});
  const [loadingModules, setLoadingModules] = useState<ModuleType[]>([]);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const cmMissing = cmAvailable === false;
  const wanted = useMemo<ModuleType[]>(
    () => (cmMissing ? ['csm'] : SHARED_MODULES),
    [cmMissing],
  );
  const chainIdRef = useRef(chainId);
  chainIdRef.current = chainId;

  useEffect(() => {
    if (!port || !origin) return;

    setByModule({});
    setLoadingModules([]);
    setLastFetchedAt(null);

    const handler = (event: PopupEvent) => {
      if (event.type === 'operators-update') {
        if (event.chainId !== chainIdRef.current) return;
        if (!wanted.includes(event.moduleType)) return;
        setByModule((prev) => ({ ...prev, [event.moduleType]: event.operators }));
        // Report the STALEST module, so "updated Xm ago" never overstates freshness.
        setLastFetchedAt((prev) => (prev === null ? event.lastFetchedAt : Math.min(prev, event.lastFetchedAt)));
      }
      if (event.type === 'operators-loading') {
        if (event.chainId !== chainIdRef.current) return;
        if (!wanted.includes(event.moduleType)) return;
        setLoadingModules((prev) =>
          event.loading
            ? (prev.includes(event.moduleType) ? prev : [...prev, event.moduleType])
            : prev.filter((m) => m !== event.moduleType),
        );
      }
    };

    port.onMessage.addListener(handler);
    for (const moduleType of wanted) {
      try {
        port.postMessage({ type: 'request-operators', origin, chainId, moduleType } satisfies PopupCommand);
      } catch {
        // Port disconnected — useWalletState reopens on focus
      }
    }
    return () => port.onMessage.removeListener(handler);
  }, [port, origin, chainId, wanted]);

  const refresh = useCallback(() => {
    if (!port || !origin) return;
    for (const moduleType of wanted) {
      try {
        port.postMessage({ type: 'refresh-operators', origin, chainId, moduleType } satisfies PopupCommand);
      } catch {
        // Port disconnected — useWalletState reopens on focus
      }
    }
  }, [port, origin, chainId, wanted]);

  const addresses = useMemo(
    () => sharedAddresses(buildAttachmentIndex(byModule)),
    [byModule],
  );

  // Counts must never render half-built, so a module that has not answered yet
  // keeps the whole tab in its loading state.
  const answered = wanted.filter((m) => byModule[m] !== undefined).length;
  const loading = loadingModules.length > 0 || answered < wanted.length;

  return { addresses, loading, lastFetchedAt, cmMissing, refresh };
}

/** Scope + search filter for the Shared tab. */
export function filterSharedAddresses(
  list: AddressAttachments[],
  search: string,
  filter: SharedFilter,
  addressLabels: Record<string, string> = {},
): AddressAttachments[] {
  const scoped = list.filter((e) => {
    if (filter === 'cross') return e.crossModule;
    if (filter === 'pending') return e.pending;
    return true;
  });

  const raw = search.trim();
  if (!raw) return scoped;

  // #N → exact operator ID match, mirroring filterOperators
  if (raw.startsWith('#')) {
    const id = raw.slice(1);
    return scoped.filter((e) => e.attachments.some((a) => a.operatorId === id));
  }

  const q = raw.toLowerCase();
  return scoped.filter(
    (e) =>
      e.address.toLowerCase().includes(q) ||
      (addressLabels[e.address.toLowerCase()] ?? '').toLowerCase().includes(q) ||
      e.attachments.some(
        (a) => a.operatorId.includes(q) || a.typeLabel.toLowerCase().includes(q),
      ),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run test/popup/use-shared-addresses.test.ts`
Expected: PASS

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
git add lib/popup/hooks.ts test/popup/use-shared-addresses.test.ts
git commit -m "feat: add useSharedAddresses hook spanning both module caches"
```

---

## Task 5: The `SharedAddresses` component and its styles

**Files:**
- Create: `entrypoints/popup/SharedAddresses.tsx`
- Modify: `entrypoints/popup/style.css`
- Create: `test/popup/shared-addresses.test.tsx`

**Interfaces:**
- Consumes: `AddressAttachments`, `countLabel` (Task 2); `filterSharedAddresses`, `SharedFilter` (Task 4)
- Produces: `<SharedAddresses />` with the props listed in Step 3

Note on "in use": `AddressSource` carries `operatorId` but **no** `moduleType`, and it is not
being extended. The connected attachment is therefore identified by
`address === selectedAddress && operatorId === selectedOperatorId && moduleType === siteModuleType`
— which is correct precisely because selecting an attachment sets the site's module to match.

- [ ] **Step 1: Write the failing test**

```tsx
// test/popup/shared-addresses.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharedAddresses } from '../../entrypoints/popup/SharedAddresses.js';
import { buildAttachmentIndex, sharedAddresses } from '../../lib/shared/attachments.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C, ADDR_D } from '../fixtures.js';

// Four shared addresses, and deliberately only THREE of them cross-module, so the
// Cross-module chip has something to narrow away:
//   A → csm#12, csm#57, cm#7   (3) cross   "2 CSM · 1 CM"
//   C → csm#57, cm#7,  cm#44   (3) cross   "1 CSM · 2 CM"
//   B → csm#12, cm#23          (2) cross   "1 CSM · 1 CM"
//   D → cm#23,  cm#44          (2) CM only "2 CM"
const addresses = sharedAddresses(
  buildAttachmentIndex({
    csm: [
      makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_A }),
      makeOperator({ id: '57', managerAddress: ADDR_C, rewardsAddress: ADDR_A, ownerAddress: ADDR_C, operatorType: 'CSM_ICS' }),
    ],
    cm: [
      makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, ownerAddress: ADDR_A, operatorType: 'CM_PO' }),
      makeOperator({ id: '23', managerAddress: ADDR_D, rewardsAddress: ADDR_B, ownerAddress: ADDR_D, operatorType: 'CM_PGO' }),
      makeOperator({ id: '44', managerAddress: ADDR_D, rewardsAddress: ADDR_C, ownerAddress: ADDR_D, operatorType: 'CM_EEO' }),
    ],
  }),
);

function renderTab(overrides: Partial<React.ComponentProps<typeof SharedAddresses>> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <SharedAddresses
      addresses={addresses}
      loading={false}
      lastFetchedAt={null}
      cmMissing={false}
      addressLabels={{}}
      siteModuleType="csm"
      onRefresh={() => {}}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...utils, onSelect };
}

describe('SharedAddresses', () => {
  it('renders one card per shared address', () => {
    const { container } = renderTab();
    expect(container.querySelectorAll('.addr-card')).toHaveLength(addresses.length);
  });

  it('shows a cross-module count for an address spanning both modules', () => {
    renderTab();
    expect(screen.getByText('2 CSM · 1 CM')).toBeInTheDocument();
  });

  it('expands a card to reveal its attachments with module-qualified types', () => {
    const { container } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    expect(screen.getByText('CSM·DEF')).toBeInTheDocument();
    expect(screen.getByText('CM·PO')).toBeInTheDocument();
  });

  it('passes the attachment module up on select', () => {
    const { container, onSelect } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const cmRow = [...container.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    fireEvent.click(cmRow.querySelector('.attach-use')!);
    expect(onSelect).toHaveBeenCalledWith(ADDR_A, '7', 'manager', 'cm');
  });

  it('marks the connected attachment as in use rather than selectable', () => {
    const { container } = renderTab({
      selectedAddress: ADDR_A,
      selectedOperatorId: '7',
      siteModuleType: 'cm',
    });
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const cmRow = [...container.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    expect(cmRow.querySelector('.attach-here')).toBeTruthy();
    expect(cmRow.querySelector('.attach-use')).toBeNull();
  });

  it('does not confuse CSM #7 with CM #7', () => {
    const both = sharedAddresses(
      buildAttachmentIndex({
        csm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
        cm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
      }),
    );
    const { container } = renderTab({
      addresses: both,
      selectedAddress: ADDR_A,
      selectedOperatorId: '7',
      siteModuleType: 'cm',
    });
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    expect(container.querySelectorAll('.attach-here')).toHaveLength(1);
    expect(container.querySelectorAll('.attach-use')).toHaveLength(1);
  });

  it('narrows to cross-module addresses when the chip is clicked', () => {
    const { container } = renderTab();
    expect(container.querySelectorAll('.addr-card')).toHaveLength(4);
    fireEvent.click(screen.getByText('Cross-module'));
    // D is CM-only and drops out.
    expect(container.querySelectorAll('.addr-card')).toHaveLength(3);
  });

  it('tells the user when CM is unavailable', () => {
    renderTab({ cmMissing: true });
    expect(screen.getByText(/CM is not deployed/i)).toBeInTheDocument();
  });

  it('shows a spinner while any module is still loading', () => {
    const { container } = renderTab({ addresses: [], loading: true });
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('explains an empty result instead of rendering nothing', () => {
    renderTab({ addresses: [], loading: false });
    expect(screen.getByText(/No shared addresses/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/popup/shared-addresses.test.tsx`
Expected: FAIL — cannot resolve `entrypoints/popup/SharedAddresses.js`

- [ ] **Step 3: Write the component**

```tsx
// entrypoints/popup/SharedAddresses.tsx
import React, { useMemo, useState } from 'react';
import type { AddressRole, ModuleType } from '../../lib/shared/types.js';
import { countLabel, type AddressAttachments, type Attachment } from '../../lib/shared/attachments.js';
import { truncateAddress, formatTimeAgo } from '../../lib/popup/utils.js';
import { useCopyAddress, filterSharedAddresses, type SharedFilter } from '../../lib/popup/hooks.js';

type Props = {
  addresses: AddressAttachments[];
  loading: boolean;
  lastFetchedAt: number | null;
  cmMissing: boolean;
  addressLabels: Record<string, string>;
  selectedAddress?: string;
  selectedOperatorId?: string;
  siteModuleType: ModuleType;
  onRefresh: () => void;
  onSelect: (
    address: string,
    operatorId: string,
    role: AddressRole,
    moduleType: ModuleType,
  ) => void;
};

export function SharedAddresses({
  addresses,
  loading,
  lastFetchedAt,
  cmMissing,
  addressLabels,
  selectedAddress,
  selectedOperatorId,
  siteModuleType,
  onRefresh,
  onSelect,
}: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SharedFilter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const shown = useMemo(
    () => filterSharedAddresses(addresses, search, filter, addressLabels),
    [addresses, search, filter, addressLabels],
  );

  return (
    <>
      <div className="search-wrapper">
        <div className="search-row">
          <div className="search-bar">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search address, label, #ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>
        </div>
        <div className="filter-bar">
          {(
            [
              ['all', 'All'],
              ['cross', 'Cross-module'],
              ['pending', 'Pending'],
            ] satisfies ReadonlyArray<readonly [SharedFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              className={`filter-btn ${filter === value ? 'active' : ''}`}
              onClick={() => setFilter(value)}
              title={
                value === 'pending'
                  ? 'Addresses caught up in a proposed role change'
                  : undefined
              }
            >
              {label}
            </button>
          ))}
          <div className="spacer" />
          {lastFetchedAt && (
            <span className="staleness-label">updated {formatTimeAgo(lastFetchedAt)}</span>
          )}
          <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
            {loading ? 'loading…' : '↻ refresh'}
          </button>
        </div>
      </div>

      {cmMissing && (
        <div className="scope-note">CM is not deployed on this network — showing CSM only.</div>
      )}

      {loading && addresses.length === 0 ? (
        <div className="loading">
          <div className="spinner" />
          <p>Loading operators...</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state-rich">
          <div className="empty-glyph">⇉</div>
          <div className="empty-headline">No shared addresses</div>
          <div className="empty-hint">
            Addresses attached to more than one operator show up here.
          </div>
        </div>
      ) : (
        <div className="addr-list">
          {shown.map((entry) => {
            const key = entry.address.toLowerCase();
            return (
              <AddressCard
                key={key}
                entry={entry}
                label={addressLabels[key] ?? ''}
                open={openKey === key}
                onToggle={() => setOpenKey(openKey === key ? null : key)}
                selectedAddress={selectedAddress}
                selectedOperatorId={selectedOperatorId}
                siteModuleType={siteModuleType}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function AddressCard({
  entry,
  label,
  open,
  onToggle,
  selectedAddress,
  selectedOperatorId,
  siteModuleType,
  onSelect,
}: {
  entry: AddressAttachments;
  label: string;
  open: boolean;
  onToggle: () => void;
  selectedAddress?: string;
  selectedOperatorId?: string;
  siteModuleType: ModuleType;
  onSelect: Props['onSelect'];
}) {
  const { copy, isCopied } = useCopyAddress();
  const copied = isCopied(entry.address);
  const connected = selectedAddress?.toLowerCase() === entry.address.toLowerCase();

  return (
    <div className={`addr-card ${connected ? 'selected' : ''}`}>
      {/* A div, not a button: the copy control lives inside and buttons cannot nest. */}
      <div className="addr-head" onClick={onToggle}>
        <span className={`addr-caret ${open ? 'open' : ''}`} aria-hidden>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 2L7 5L3.5 8" />
          </svg>
        </span>
        <span className="addr-text mono">{truncateAddress(entry.address)}</span>
        {label && <span className="addr-label">{label}</span>}
        <div className="spacer" />
        <span className={`attach-count ${entry.crossModule ? 'cross' : ''}`}>
          {countLabel(entry)}
        </span>
        <button
          className={`chip-copy ${copied ? 'copied' : ''}`}
          onClick={(e) => { e.stopPropagation(); copy(entry.address); }}
          title="Copy address"
        >
          {copied ? '✓' : '⎘'}
        </button>
      </div>

      {open && (
        <div className="addr-body">
          {entry.attachments.map((att) => (
            <AttachmentRow
              key={`${att.moduleType}:${att.operatorId}`}
              attachment={att}
              // (id, module) — CSM #7 and CM #7 are different operators.
              inUse={
                connected &&
                selectedOperatorId === att.operatorId &&
                siteModuleType === att.moduleType
              }
              siteModuleType={siteModuleType}
              onSelect={() =>
                onSelect(entry.address, att.operatorId, att.primaryRole, att.moduleType)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment: att,
  inUse,
  siteModuleType,
  onSelect,
}: {
  attachment: Attachment;
  inUse: boolean;
  siteModuleType: ModuleType;
  onSelect: () => void;
}) {
  const crossModule = att.moduleType !== siteModuleType;

  return (
    <div className={`attach-row kind-${att.kind} ${inUse ? 'current' : ''}`}>
      <span className="attach-ribbon" />
      <span className="attach-id mono">#{att.operatorId}</span>
      <span className="attach-type">{att.typeLabel}</span>
      <div className="chip-pills">
        {att.pills.map((p) => (
          <span
            key={p.label}
            className={`role-pill ${p.proposed ? 'dashed' : `tint-${p.tint}`} ${p.owner ? 'owner' : ''}`}
          >
            {p.label}
          </span>
        ))}
      </div>
      <div className="spacer" />
      {inUse ? (
        <span className="attach-here">in use</span>
      ) : (
        <button
          className={`attach-use ${crossModule ? 'cross' : ''}`}
          onClick={onSelect}
          title={crossModule ? `Switches the module to ${att.moduleType.toUpperCase()}` : undefined}
        >
          {crossModule ? `use in ${att.moduleType.toUpperCase()}` : 'use'}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

In `entrypoints/popup/style.css`, first make the ribbon-colour classes reusable outside
`.operator-row`. Immediately after the `.operator-row { ... }` rule block (which ends with
`--ribbon-color: #64748b;`), add:

```css
/* Ribbon colour default for attachment rows — must precede the kind-* rules,
   which share its specificity and win on source order. */
.attach-row {
  --ribbon-color: #64748b;
}
```

Then strip the `.operator-row` prefix from all twelve kind rules so any element can carry them,
e.g. `.operator-row.kind-csm-def { ... }` becomes `.kind-csm-def { ... }`. Do this for
`kind-csm-def`, `kind-csm-lea`, `kind-csm-ics`, `kind-csm-idvtc`, `kind-cm-po`, `kind-cm-pto`,
`kind-cm-pgo`, `kind-cm-do`, `kind-cm-eeo`, `kind-cm-iodc`, `kind-cm-iodcp`, `kind-cc`.

Then append a new section at the end of the file:

```css
/* ── Shared addresses tab ─────────────────────────── */

.scope-note {
  margin: 6px 14px 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--warn) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--warn) 26%, transparent);
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--dim);
}

.addr-list {
  padding: 4px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.addr-card {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius);
  overflow: hidden;
}

.addr-card.selected {
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.addr-head {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 6px 0 7px;
  cursor: pointer;
}

.addr-head:hover {
  background: color-mix(in srgb, var(--surface-2) 55%, transparent);
}

.addr-caret {
  display: inline-grid;
  place-items: center;
  width: 12px;
  height: 12px;
  color: var(--dim);
  flex-shrink: 0;
  transition: transform 140ms;
}

.addr-caret.open {
  transform: rotate(90deg);
}

.addr-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  flex-shrink: 0;
}

.addr-label {
  font-size: 11px;
  color: var(--dim);
  font-style: italic;
  min-width: 0;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-count {
  font-family: 'SF Mono', 'Consolas', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 600;
  color: var(--dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 99px;
  padding: 1px 7px;
  line-height: 1.5;
  flex-shrink: 0;
}

.attach-count.cross {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  border-color: color-mix(in srgb, var(--warn) 30%, transparent);
}

.addr-body {
  padding: 3px 6px 5px 7px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border);
}

.attach-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 4px 0 0;
  border-radius: 6px;
  border: 1px solid transparent;
}

.attach-row:hover {
  background: var(--surface-2);
}

.attach-row.current {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--accent) 32%, transparent);
}

.attach-ribbon {
  width: 3px;
  height: 17px;
  border-radius: 0 2px 2px 0;
  background: var(--ribbon-color);
  flex-shrink: 0;
}

.attach-id {
  font-size: 11px;
  font-weight: 600;
  color: var(--ribbon-color);
  flex-shrink: 0;
}

.attach-type {
  font-family: 'SF Mono', 'Consolas', ui-monospace, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--ribbon-color);
  background: color-mix(in srgb, var(--ribbon-color) 18%, transparent);
  flex-shrink: 0;
}

.attach-here {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--accent);
  flex-shrink: 0;
  padding-right: 3px;
}

.attach-use {
  font-size: 10px;
  color: var(--dim);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  flex-shrink: 0;
}

.attach-use:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.attach-use.cross {
  color: var(--warn);
  border-color: color-mix(in srgb, var(--warn) 34%, transparent);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run test/popup/shared-addresses.test.tsx`
Expected: PASS

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test
git add entrypoints/popup/SharedAddresses.tsx entrypoints/popup/style.css test/popup/shared-addresses.test.tsx
git commit -m "feat: add SharedAddresses tab component"
```

---

## Task 6: Wire the tab into `App`, and move Settings into the header

**Files:**
- Modify: `entrypoints/popup/App.tsx`
- Modify: `test/e2e/helpers.ts` (`TabName`, `goToTab`)
- Modify: `test/popup/app-active-tab.test.tsx` (add a case)

**Interfaces:**
- Consumes: `useSharedAddresses` (Task 4), `<SharedAddresses />` (Task 5), `select-address`'s `moduleType` (Task 3)

`goToTab(page, 'Settings')` currently clicks `button.tab:has-text("Settings")` and is used by
`test/e2e/settings-rpc.e2e.ts`. Moving Settings out of the tab bar breaks it, so the helper is
updated in the same task.

- [ ] **Step 1: Write the failing test**

In `test/popup/app-active-tab.test.tsx`, first widen the file's `tab()` helper union (Settings is
no longer a tab button, Shared is):

```ts
function tab(name: 'Operators' | 'Groups' | 'Shared' | 'Manual' | 'Anvil') {
  return screen.getByRole('button', { name });
}
```

Then append these two cases inside the existing `describe`, using the file's own `mountApp`
helper and `port._emit` state pattern:

```tsx
  it('renders a Shared tab and keeps Settings out of the tab bar', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState() } satisfies PopupEvent);
    });

    const tabLabels = [...document.querySelectorAll('button.tab')].map((el) => el.textContent);
    expect(tabLabels).toContain('Shared');
    expect(tabLabels).not.toContain('Settings');

    // Settings is reachable from the header instead.
    expect(document.querySelector('.icon-btn[title="Settings"]')).toBeTruthy();
  });

  it('restores the persisted Shared tab on open', async () => {
    await mountApp(port);

    act(() => {
      port._emit({
        type: 'state-update',
        state: makeState({ activeTab: 'shared' }),
      } satisfies PopupEvent);
    });

    expect(tab('Shared')).toHaveClass('active');
    expect(tab('Operators')).not.toHaveClass('active');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run test/popup/app-active-tab.test.tsx`
Expected: FAIL — no `Shared` tab, and `Settings` is still in the tab bar

- [ ] **Step 3: Wire it up in `App.tsx`**

Add the imports:

```ts
import { SharedAddresses } from './SharedAddresses.js';
```

and add `useSharedAddresses` to the existing `lib/popup/hooks.js` import list.

After the `useOperators` call, add:

```ts
  const sharedAddrs = useSharedAddresses(port, origin, state.chainId, availableModules.cm);
```

In the header, add a Settings button right after the theme toggle:

```tsx
        <button
          className="icon-btn"
          onClick={() => selectTab('settings')}
          title="Settings"
        >
          ⚙
        </button>
```

Replace the tab list literal so `Settings` is gone and `Shared` is in:

```tsx
        {(
          [
            ['operators', 'Operators'],
            ...(showGroups ? ([['groups', 'Groups']] as const) : []),
            ['shared', 'Shared'],
            ['manual', 'Manual'],
            ...(onAnvil ? ([['anvil', 'Anvil']] as const) : []),
          ] satisfies ReadonlyArray<readonly [Tab, string]>
        ).map(([t, label]) => (
```

Add the tab body, after the `manual` block:

```tsx
        {activeTab === 'shared' && (
          <SharedAddresses
            addresses={sharedAddrs.addresses}
            loading={sharedAddrs.loading}
            lastFetchedAt={sharedAddrs.lastFetchedAt}
            cmMissing={sharedAddrs.cmMissing}
            addressLabels={state.addressLabels}
            selectedAddress={state.selectedAddress?.address}
            selectedOperatorId={
              state.selectedAddress?.source.type === 'operator'
                ? state.selectedAddress.source.operatorId
                : undefined
            }
            siteModuleType={state.moduleType}
            onRefresh={sharedAddrs.refresh}
            onSelect={(address, operatorId, role, moduleType) =>
              send({
                type: 'select-address',
                address,
                source: { type: 'operator', operatorId, role },
                // Only sent when it differs, so same-module picks keep the existing behaviour.
                ...(moduleType !== state.moduleType ? { moduleType } : {}),
              })
            }
          />
        )}
```

No `activeTab` fallback is needed for `'shared'` — unlike Groups and Anvil the tab is always
available, working from CSM alone when CM is not deployed.

- [ ] **Step 4: Update the e2e tab helper**

In `test/e2e/helpers.ts`:

```ts
export type TabName = 'Operators' | 'Shared' | 'Manual' | 'Settings';

export async function goToTab(page: Page, tab: TabName) {
  // Settings moved out of the tab bar into a header icon button.
  if (tab === 'Settings') {
    await page.click('.icon-btn[title="Settings"]');
    await page.waitForSelector('.settings-group');
    return;
  }
  await page.click(`button.tab:has-text("${tab}")`);
  if (tab === 'Manual') await page.waitForSelector('.manual-form');
  if (tab === 'Operators') await page.waitForSelector('.search-bar input');
  if (tab === 'Shared') await page.waitForSelector('.filter-bar');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck
git add entrypoints/popup/App.tsx test/popup/app-active-tab.test.tsx test/e2e/helpers.ts
git commit -m "feat: add Shared tab, move Settings to a header button"
```

---

## Task 7: End-to-end coverage and docs

This is where the background `select-address` module switch from Task 3 is actually exercised —
`handlePopupCommand` is not exported, so it cannot be unit-tested.

**Files:**
- Create: `test/e2e/shared-addresses.e2e.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the e2e suite**

```ts
/**
 * E2E: Shared addresses — cross-module index, filters, module-switching select.
 *
 * Run: npx tsx test/e2e/shared-addresses.e2e.ts
 * Requires: pnpm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedState,
  seedModuleAvailability,
  goToTab,
  createRunner,
} from './helpers.js';
import type { CachedOperator } from '../../lib/shared/types.js';

const SHARED = '0x1111111111111111111111111111111111111111';
const SOLO = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const PROPOSED_ONLY = '0x4444444444444444444444444444444444444444';

const CSM_OPS: CachedOperator[] = [
  {
    id: '12', managerAddress: SHARED, rewardsAddress: OTHER,
    extendedManagerPermissions: true, ownerAddress: SHARED,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  {
    id: '99', managerAddress: SOLO, rewardsAddress: SOLO,
    extendedManagerPermissions: true, ownerAddress: SOLO,
    curveId: '0', operatorType: 'CSM_DEF',
  },
];

const CM_OPS: CachedOperator[] = [
  {
    id: '7', managerAddress: SHARED, rewardsAddress: OTHER,
    extendedManagerPermissions: true, ownerAddress: SHARED,
    curveId: '0', operatorType: 'CM_PO',
  },
  {
    id: '44', managerAddress: OTHER, rewardsAddress: OTHER,
    proposedManagerAddress: PROPOSED_ONLY,
    extendedManagerPermissions: true, ownerAddress: OTHER,
    curveId: '0', operatorType: 'CM_EEO',
  },
];

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  async function seedFresh() {
    await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
    await seedOperators(sw, CSM_OPS, 1, 'csm');
    await seedOperators(sw, CM_OPS, 1, 'cm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: true });
  }

  try {
    await test('Lists only addresses attached to more than one operator', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      const text = await page.locator('.addr-list').innerText();
      if (!text.includes(SHARED.slice(0, 6))) throw new Error('shared address missing');
      if (text.includes(SOLO.slice(0, 6))) throw new Error('single-attachment address should not be listed');
      await page.close();
    });

    await test('Counts attachments across both modules', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      const count = await page.locator('.addr-card').first().locator('.attach-count').innerText();
      if (count !== '1 CSM · 1 CM') throw new Error(`expected "1 CSM · 1 CM", got "${count}"`);
      await page.close();
    });

    await test('Pending filter keeps only addresses with a proposed role', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      await page.click('.filter-btn:has-text("Pending")');
      await page.waitForTimeout(200);

      const text = await page.locator('.content').innerText();
      if (text.includes(SHARED.slice(0, 6))) throw new Error('non-pending address should be filtered out');
      await page.close();
    });

    await test('Selecting a CM attachment connects it and switches the module', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      await page.locator('.addr-head').first().click();
      await page.waitForSelector('.attach-row');

      const cmRow = page.locator('.attach-row', { hasText: 'CM·PO' });
      await cmRow.locator('.attach-use').click();
      await page.waitForTimeout(400);

      const pill = await page.locator('.connected-pill').innerText();
      if (!pill.toLowerCase().includes(SHARED.slice(0, 6).toLowerCase())) {
        throw new Error(`connected pill does not show the address: ${pill}`);
      }

      const chip = await page.locator('.netmod-chip .mod-label').innerText();
      if (chip !== 'CM') throw new Error(`expected module chip to read CM, got "${chip}"`);
      await page.close();
    });

    await test('Falls back to CSM alone when CM is unavailable', async () => {
      await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
      await seedOperators(sw, CSM_OPS, 1, 'csm');
      await seedModuleAvailability(sw, 1, { csm: true, cm: false });

      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.scope-note');

      const note = await page.locator('.scope-note').innerText();
      if (!note.includes('CM')) throw new Error(`expected a CM-unavailable note, got "${note}"`);
      await page.close();
    });
  } finally {
    await context.close();
  }

  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Run the e2e suite**

No registration is needed — `test/e2e/run-all.ts` discovers every `*.e2e.ts` in the directory
with `readdirSync`, so the new file is picked up automatically.

Run: `pnpm run test:e2e`
Expected: PASS, including the pre-existing `settings-rpc` suite, which now reaches Settings through the header button.

- [ ] **Step 3: Update `CLAUDE.md`**

In the **File Structure** block, add under `entrypoints/popup/`:

```
  SharedAddresses.tsx  — Shared tab: addresses attached to >1 operator, across modules
```

and under `lib/shared/`:

```
  attachments.ts       — address → attachments reverse index (both module caches)
```

Add to **Gotchas**:

```
- **Operator identity is (id, module):** CSM #7 and CM #7 are different operators. Anything
  comparing operators across modules — the Shared tab, `buildAttachmentIndex` — must key on the
  pair, never the bare id.
- **Proposed roles are attachments:** `P-MGR`/`P-RWD` count in `buildAttachmentIndex`, which is
  what the Shared tab's Pending filter selects on.
- **Settings is not a tab:** it lives in the header as an `icon-btn`, because six tabs overflow
  the 400px popup. `goToTab(page, 'Settings')` in the e2e helpers clicks that button.
- **Shared tab spans both modules:** it issues `request-operators` for CSM *and* CM and stays in
  its loading state until both answer, so counts never render half-built.
```

- [ ] **Step 4: Full verification and commit**

```bash
pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run test:e2e
git add test/e2e/shared-addresses.e2e.ts CLAUDE.md
git commit -m "test: add shared-addresses e2e suite; docs: note cross-module invariants"
```

---

## Verification

After Task 7, the spec's acceptance list should hold:

| Acceptance criterion | Covered by |
| --- | --- |
| Only >1-attachment addresses listed | `sharedAddresses` unit test; e2e "Lists only addresses…" |
| Four attachments incl. proposed → `2 CSM · 2 CM` | `buildAttachmentIndex` / `countLabel` unit tests |
| Cross-module and Pending filters | `filterSharedAddresses` unit tests; component test; e2e Pending |
| Cross-module select connects **and** switches module | e2e "Selecting a CM attachment…" |
| CM unavailable → CSM-only, said out loud | hook test; component test; e2e fallback |
| Tab bar fits, Settings in header | `app-active-tab` test; existing `settings-rpc` e2e still passing |
