---
date: 2026-03-07
topic: connection-prompt
---

# Connection Prompt for New Sites

## Problem

When a dapp calls `eth_requestAccounts` and no address is set for that origin, the wallet silently returns `[]`. Dapps treat this as "not connected" — the user must manually open the extension popup to select an address before the dapp can detect the wallet. This creates a confusing first-connection experience.

## Decision

Automatically open a popup window when an unconnected dapp requests accounts, letting the user select an address inline with the dapp's connection flow. Reuse the existing approval window pattern (`chrome.windows.create()` + pending promise map).

### Key Choices

- **No new entry points:** Reuse `popup.html` with `?origin=` URL param
- **No new message types:** Connection resolved via existing `select-address` flow
- **One prompt per origin:** If already pending, focus existing window instead of opening another
- **Graceful close:** Closing window without selecting resolves with `[]` (not an error)
- **`eth_accounts` unchanged:** Still returns `[]` silently — only `eth_requestAccounts` triggers the prompt

## Design

### Flow

1. Dapp calls `eth_requestAccounts`
2. `handleWithApproval` checks `siteState.selectedAddress`
   - If set → fall through to `handleRpcRequest` (already connected)
   - If not → `requestConnection(origin)` opens popup window
3. User selects address in popup → `select-address` message resolves pending promise + closes window
4. Dapp receives `[address]`

### State

```
pendingConnections: Map<origin, { promise, resolve, windowId }>
```

Keyed by origin so duplicate requests from the same dapp reuse the same window.

### `useActiveTabOrigin` Change

Popup checks `window.location.search` for `origin` param before falling back to `chrome.tabs.query`. This lets the popup work correctly as both an extension popup and a standalone connection prompt window.
