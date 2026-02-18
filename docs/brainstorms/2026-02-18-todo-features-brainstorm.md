---
date: 2026-02-18
topic: todo-features-clipboard-labels-approval
---

# Clipboard Copy, Address Labels, Approval Modal

## What We're Building

Three QA-quality-of-life features from `docs/TODO.md`, ordered by complexity:

1. **Clipboard copy** — icon button next to each truncated address to copy full hex
2. **Address labels** — inline-editable names for addresses, searchable in operator list
3. **Request approval modal** — optional confirmation window before Anvil signing

## Key Decisions

- **Copy UX:** Icon button beside address (not long-press or double-click). Row click still connects. `e.stopPropagation()` separates the two actions cleanly.
- **Labels scoping:** Global (not per-network) since addresses are unique across chains. Stored as `Record<lowercase address, string>` in `WalletState`.
- **Labels editing:** Inline on address rows (pencil icon, click to edit). No dedicated address book tab — keeps things fast and contextual.
- **Labels in search:** Yes — typing a label name filters matching operators. Natural for testers who name addresses.
- **Approval trigger:** Separate Chrome window via `chrome.windows.create()` (not popup modal). Works even when popup is closed. More reliable than programmatic popup opening.
- **Approval content:** Minimal — method name + from address only. Covers the "pause and think" QA use case without decoding overhead.
- **Approval toggle:** Off by default. Checkbox in Settings: "Require approval for signing (Anvil only)".

## Why These Approaches

- **Icon button over long-press:** Most discoverable. Long-press has no affordance in a desktop Chrome popup.
- **Inline edit over address book tab:** Testers label addresses in context while browsing operators. A separate tab adds navigation friction for a simple action.
- **Separate window over popup modal:** The popup may not be open when a dapp triggers signing. `chrome.windows.create` is the standard pattern (MetaMask does this). Auto-reject on window close prevents hanging promises.
- **Minimal approval info:** This is a dev/QA tool, not a production wallet. Method + address is enough to test the "user takes time to approve" flow.

## Open Questions

None — all decisions made during brainstorm.

## Next Steps

Implementation in three phases (each independently shippable). See plan file for details.
