# CSM Dev Wallet — Chrome Extension

**Date:** 2026-02-15
**Status:** Brainstorm

## What We're Building

A Chrome extension that emulates an Ethereum wallet, purpose-built for manual QA testing of the CSM widget. It lets testers instantly connect to a dapp as any CSM operator (by manager, rewards, or owner address) without needing private keys. The extension fetches and caches the full operator list from CSM contracts via `lido-csm-sdk`, supports network switching (Mainnet, Hoodi, local Anvil fork), and injects a standard EIP-1193 provider that the dapp's Reef-Knot/Wagmi stack detects automatically.

### Core Capabilities

- **Operator browser:** Fetch all operators per network, display ID + addresses (manager, rewards, proposed manager/rewards if non-zero) + indicate which address has extended-manager-permissions (owner), searchable/filterable
- **Quick connect:** Select an operator + address role (manager/rewards/proposed) to connect as that address
- **Watch-only mode:** Connected addresses cannot sign transactions - show clear warning when dapp requests signing
- **Network selector:** Mainnet, Hoodi, local Anvil fork. For Anvil: auto-detect if fork is running and which network (mainnet/hoodi) it forks
- **Favorites & recents:** Pin frequently used operators, track recently used connections
- **Custom addresses:** Connect with arbitrary addresses (random or manually added)
- **Private key support:** Optionally add private keys for addresses that can actually sign
- **Anvil addresses:** When on local Anvil network, list and connect with auto-generated Anvil accounts
- **Operator cache:** All operators stored in extension storage, refreshed on popup open
- **Settings:** Configurable RPC URLs per network

## Why This Approach

### CSM-Specific over Generic

Building CSM-specific means operator browsing, address role selection, and SDK integration are first-class. No abstraction tax for features we don't need. The extension is a testing tool for one product - simplicity wins.

### Popup UI over Side Panel

Popup is the most established Chrome extension UX pattern. Quick to open, sufficient space for an operator list + search. Avoids newer API compatibility concerns.

### lido-csm-sdk over Direct Contract Calls

Bundling the SDK keeps operator fetching logic in sync with contract changes. No ABI maintenance burden. The SDK already handles the complexity of resolving operator addresses and roles.

### Fetch All + Cache over On-Demand

CSM operator count is manageable. Fetching all operators and caching locally enables instant search/filter without network roundtrips during testing sessions. Each network (mainnet, hoodi, anvil fork) maintains its own separate operator cache.

## Key Decisions

1. **Primary use case:** Manual QA testing (automation-friendly as bonus)
2. **Scope:** CSM-widget-specific, not a generic testing wallet
3. **Watch-only behavior:** Block transactions with clear warning for watch-only addresses
4. **Data source:** Bundle `lido-csm-sdk` for operator fetching
5. **Operator loading:** Fetch all operators upfront, cache in extension storage
6. **Tech stack:** React + Vite for popup UI
7. **UI surface:** Chrome extension popup
8. **Wallet injection:** EIP-1193 provider on `window.ethereum` + EIP-6963 announcement for Reef-Knot detection

## Architecture Sketch

```
+------------------+     Chrome Messaging     +-------------------+
|   Popup UI       | <----------------------> |  Service Worker    |
|   (React+Vite)   |                          |  (Background)      |
|                  |                          |                   |
| - Network select |                          | - Operator cache  |
| - Operator list  |                          | - SDK instance    |
| - Address picker |                          | - RPC routing     |
| - Favorites      |                          | - State mgmt      |
| - Settings       |                          | - Private keys    |
+------------------+                          +-------------------+
                                                      ^
                                                      | Chrome Messaging
                                                      v
                                              +-------------------+
                                              |  Content Script   |
                                              |                   |
                                              | - Injects EIP-1193|
                                              |   provider        |
                                              | - EIP-6963 events |
                                              | - Proxies RPC to  |
                                              |   service worker  |
                                              +-------------------+
                                                      ^
                                                      | window.ethereum
                                                      v
                                              +-------------------+
                                              |   Dapp (CSM Widget)|
                                              +-------------------+
```

## Address Types

| Type | Can Browse | Can Sign | Source |
|------|-----------|----------|--------|
| Operator manager | Yes | No (watch-only) | SDK fetch per network. Marked as "owner" if has extended-manager-permissions |
| Operator rewards | Yes | No (watch-only) | SDK fetch per network. Marked as "owner" if has extended-manager-permissions |
| Operator proposed manager/rewards | Yes (if non-zero) | No (watch-only) | SDK fetch per network |
| Manually added (no key) | Yes | No (watch-only) | User input |
| Manually added (with key) | Yes | Yes | User input |
| Anvil auto-generated | Yes (on Anvil) | Yes | Anvil RPC |

## Key Assumptions

- **SDK in service worker:** `lido-csm-sdk` uses viem which should work in a service worker (no DOM dependency). Must verify during planning — if SDK has browser-only deps, fallback is direct viem contract reads with CSM ABIs.

## Resolved Questions

1. **Anvil impersonation:** Deferred to v2. V1 is watch-only for operator addresses. Impersonation (`anvil_impersonateAccount`) will be added later.
2. **Operator detail level:** ID + addresses only (manager, rewards, proposed if non-zero). Owner is not a separate address — it's whichever of manager/rewards has extended-manager-permissions. No bond, keys, or status.
3. **Cache refresh interval:** Refresh on popup open. No background polling. Simple and effective.
4. **Extension name:** "CSM Dev Wallet"

## Future Considerations (v2+)

- Anvil impersonation for watch-only addresses on local fork
- Event-based cache invalidation: subscribe to `NodeOperatorAdded`, `ManagerAddressChangeProposed`, `RewardAddressChangeProposed`, and role-change events to auto-refresh affected operators
- Side panel UI for richer operator browsing
- Playwright integration / automation API
- Export/import operator favorites
