---
date: 2026-09-25
topic: Mark operators with fee splits (splitters)
---

# Fee splits marker + filter

Mock: https://claude.ai/artifact/V3TuPAaHvKtzWx77rxHR31 (option B badge chosen).

## What

- Operators whose Accounting v3 `getFeeSplits(id)` is non-empty get an `SPL·N` badge (N = recipient count) in the operator header, right after the type badge.
- Badge hint (multi-line): `Fee splits · N recipient(s)`, one `0x71c4…a92b · 40.00%` line per recipient, `Operator keeps 35.00%`.
- New `Splits` filter chip after `Claimer` on the Operators tab (list-only, like Pending/Claimer — on Groups it reads as All). Clicking the badge applies it.
- Plain-text search also matches split recipient addresses and their address labels.

## Decisions

- **Not a role, not an attachment.** Recipients are not operator addresses the widget resolves; they stay out of `roleEntries` / `buildAttachmentIndex` and the Shared tab. Not selectable chips.
- **Share units:** basis points, `MAX_BP = 10_000` (staking-modules `FeeSplits.sol`); totals may be < 10 000, remainder stays with the operator.
- **Fetch:** one `multicall` of `getFeeSplits` per module fetch, `allowFailure: true`, Accounting address from `MODULE_CONFIG[module][contractChainId].contractAddresses.accounting`. Missing config, a reverting call (pre-v3), or a failed multicall leaves operators unmarked — never fails the operator fetch.
- **Storage:** `feeSplits?: { recipient: Address; share: string }[]` on `CachedOperator`, `share` stringified (no BigInt in `chrome.storage`). Set only when non-empty; absent = none or unknown. Old caches simply lack it until the next refresh.

## Plan

1. `lib/shared/types.ts` — `FeeSplit` type + optional `feeSplits` on `CachedOperator`.
2. `lib/background/operator-cache.ts` — `enrichWithFeeSplits`, called for every module after the batch read (alongside CM groups). Tests in `test/background/operator-cache.test.ts`: sets field, omits empty, per-call failure tolerated, whole multicall failure tolerated, missing accounting config skips the call.
3. `lib/popup/utils.ts` (next to `truncateAddress`) — `feeSplitsHint(splits)` + bps → `40.00%` formatting. Unit tests.
4. `lib/popup/hooks.ts` — `FilterGroup` gains `'splits'`; `filterByGroup`, `filterGroupedView` select `feeSplits?.length`; `filterOperators` matches recipients + labels. Tests in existing filter test files.
5. `entrypoints/popup/OperatorList.tsx` — badge in `OperatorRow`; `<button>` only when an `onSplitsClick` prop is passed (Operators list), plain `<span>` otherwise (Groups tab). `App.tsx` — `Splits` chip inside the `showPending` block, `groupScope` maps `'splits'` → `'all'` too, badge click → `setFilterGroup('splits')`. `OperatorGroups.tsx` — `No fee splits set` empty state for parity.
6. `style.css` — `.operator-splits` (neutral: surface-2 bg, border-strong, text colour, same metrics as `.operator-type`); `.hint.hint-pre::after { white-space: pre-line }`.
7. E2E — `test/e2e/operators.e2e.ts`: seeded operator with `feeSplits` shows the badge; Splits chip narrows the list.
8. `CLAUDE.md` gotcha: fee splits come from Accounting, bps, not attachments.
