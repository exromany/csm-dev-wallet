---
date: 2026-03-04
topic: per-origin-state
---

# Per-Origin State

## Problem

The extension shares a single global WalletState across all sites — one network, one active address, broadcast to every tab. When testing CSM widget on mainnet in one tab and Hoodi in another, changing network in one tab affects the other.

## Decision

Each site (scoped by origin) gets its own network and address selection. Global settings (RPC URLs, favorites, labels, manual addresses, approval) stay shared.

### Use Case

Testing multiple dapps simultaneously on different networks (e.g. CSM widget on mainnet in one tab, Hoodi in another).

### Key Choices

- **Scope:** Origin (`https://stake.lido.fi`) — matches MetaMask's model
- **New sites:** Start disconnected (no address, default to mainnet)
- **Persistence:** Per-origin state persists across browser restarts (`chrome.storage.local`)
- **Popup:** Shows active tab's state via `chrome.tabs.query({ active: true, currentWindow: true })`

## Design

### State Split

**`SiteState`** (per-origin): `chainId`, `moduleType`, `selectedAddress`, `isConnected`

**`GlobalSettings`** (shared): `customRpcUrls`, `favorites`, `manualAddresses`, `addressLabels`, `requireApproval`

Popup receives a composed `WalletState = SiteState & GlobalSettings`.

### Storage

Two keys replace the old single `wallet_state`:
- `global_settings` → `GlobalSettings`
- `site_states` → `Record<string, SiteState>` (origin → state)

Legacy `wallet_state` auto-migrated on first access.

### Message Protocol

- `RpcRequestMessage` includes `origin` (content script sets `window.location.origin`)
- All `PopupCommand` variants include `origin` (popup resolves via `chrome.tabs.query`)
- `BroadcastMessage` includes `origin` — content script filters by match

### Broadcast Targeting

`notifyAccountsChanged` and `notifyChainChanged` only send to tabs whose URL origin matches.

## Alternatives Considered

1. **Tab-to-Origin Registry** — overlay overrides on global state. Rejected: two sources of truth.
2. **Fully Tab-Scoped** — each tab independent. Rejected: two tabs on same dapp would diverge, confusing.
