# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CSM Dev Wallet — a Chrome extension (Manifest V3) for manual QA testing of the Lido CSM widget. Emulates an Ethereum wallet that lets testers connect to a dapp as any CSM operator address without needing private keys.

## Architecture

Three-layer Chrome extension:

- **Popup UI** (React + Vite) — network selector, operator list with search/filter, address picker, favorites, settings
- **Service Worker** (background) — operator cache in extension storage, `lido-csm-sdk` instance for fetching operators, RPC routing, state management, private key storage
- **Content Script** — injects EIP-1193 provider (`window.ethereum`) + EIP-6963 announcement for Reef-Knot/Wagmi detection, proxies RPC calls to service worker via Chrome messaging

Communication between layers uses Chrome Messaging API.

## Key Design Decisions

- **Watch-only by default:** Operator addresses cannot sign — block `eth_sendTransaction`/`eth_signTypedData` with clear warning. Only manually-added keys and Anvil accounts can sign.
- **CSM-specific, not generic:** Operator browsing and address role selection (manager/rewards/proposed) are first-class. Uses `lido-csm-sdk` directly — no ABI maintenance.
- **Fetch-all + cache:** All operators fetched on popup open, cached per-network in extension storage. Operator count is manageable.
- **Networks:** Mainnet, Hoodi, local Anvil fork (auto-detect which network it forks). Configurable RPC URLs.
- **Owner indicator:** Not a separate address — whichever of manager/rewards has extended-manager-permissions is marked as "owner".

## Commands

```bash
npm run dev      # WXT dev mode with hot reload
npm run build    # Production build → .output/chrome-mv3/
npm run zip      # Build + zip for distribution
```

Load unpacked from `.output/chrome-mv3-dev/` (dev) or `.output/chrome-mv3/` (prod) in `chrome://extensions`.

## File Structure

```
entrypoints/
  background.ts        — service worker (WXT defineBackground)
  content.ts           — content script bridge (WXT defineContentScript)
  inpage.ts            — EIP-1193 provider injected into MAIN world
  popup/               — React UI
lib/
  background/          — service worker modules (state, RPC, SDK, cache, keys, anvil)
  popup/               — React hooks and utils
  shared/              — types, messages, network configs (used by all layers)
```

## Tech Stack

- WXT (browser extension framework, wraps Vite)
- React (popup UI)
- viem (Ethereum interactions, used by lido-csm-sdk)
- lido-csm-sdk (operator data fetching)
- Chrome Extension Manifest V3

## Code Style

- Use `.js` extensions in TypeScript imports (ESM resolution via WXT)
- WXT entry helpers: `defineBackground`, `defineContentScript`, `defineUnlistedScript`
- TypeScript strict mode enabled

## Gotchas

- **BigInt serialization:** `chrome.storage` can't hold BigInts — operator `id` and `curveId` stored as strings, convert back when needed
- **SDK field naming:** lido-csm-sdk uses singular `rewardAddress`/`proposedRewardAddress`, our types use plural `rewardsAddress`/`proposedRewardsAddress` — mapping happens in `operator-cache.ts`
- **Storage split:** Private keys in `chrome.storage.session` (wiped on browser close, QA-safe). Wallet state + operator cache in `chrome.storage.local` (persists)
- **CSM SDK imports:** Contract addresses come from `@lidofinance/lido-csm-sdk/common` subpath, not the main entry
- **Content script timing:** Must run at `document_start` to inject provider before dapp scripts execute
- **CM module:** May not be deployed on all networks — `fetchAllOperators` catches and re-throws after caching empty result

## Related Repos

- `lido-csm-sdk` — SDK for CSM contract interactions (sibling at `../lido-csm-sdk/packages/csm-sdk/`)
- `ethereum-staking-widget` — the dapp this extension tests (sibling at `../ethereum-staking-widget/`)
- `lido-ethereum-sdk` — Lido protocol SDK (sibling at `../lido-ethereum-sdk/packages/sdk/`)
