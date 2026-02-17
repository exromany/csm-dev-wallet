# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CSM Dev Wallet — a Chrome extension (Manifest V3) for manual QA testing of the Lido CSM widget. Emulates an Ethereum wallet that lets testers connect to a dapp as any CSM operator address without needing private keys.

## Architecture

Three-layer Chrome extension:

- **Popup UI** (React + Vite) — network selector, operator list with search/filter, address picker, favorites, settings
- **Service Worker** (background) — operator cache in extension storage, direct viem contract reads via `SMDiscoveryAbi`, RPC routing, state management, Anvil impersonation signing
- **Content Script** — injects EIP-1193 provider (`window.ethereum`) + EIP-6963 announcement for Reef-Knot/Wagmi detection, proxies RPC calls to service worker via Chrome messaging

Communication between layers uses Chrome Messaging API.

## Key Design Decisions

- **Watch-only by default:** Operator addresses cannot sign — block signing RPCs (`eth_sendTransaction`, `eth_signTypedData_v4`, `personal_sign`, `eth_sign`) with clear warning. Only Anvil fork (chainId 31337) supports signing via `anvil_impersonateAccount`.
- **CSM-specific, not generic:** Operator browsing and address role selection (manager/rewards/proposed) are first-class. Uses `SMDiscoveryAbi` and contract addresses from `@lidofinance/lido-csm-sdk` — ABI comes from SDK package, not maintained locally.
- **Fetch-all + cache:** All operators fetched on popup open, cached per-network in extension storage. Operator count is manageable.
- **Networks:** Mainnet, Hoodi, local Anvil fork (auto-detect which network it forks). Configurable RPC URLs.
- **Owner indicator:** Not a separate address — whichever of manager/rewards has extended-manager-permissions is marked as "owner".

## Commands

```bash
npm run dev        # WXT dev mode with hot reload
npm run build      # Production build → .output/chrome-mv3/
npm run zip        # Build + zip for distribution
npm run test       # vitest single run
npm run test:watch # vitest watch mode
npm run test:e2e   # build + Playwright e2e suite (all *.e2e.ts files)
npm run lint       # oxlint
npm run typecheck  # tsc --noEmit
```

Requires Node >=24. Load unpacked from `.output/chrome-mv3-dev/` (dev) or `.output/chrome-mv3/` (prod) in `chrome://extensions`.

## File Structure

```
entrypoints/
  background.ts        — service worker (WXT defineBackground)
  content.ts           — content script bridge (WXT defineContentScript)
  inpage.ts            — EIP-1193 provider injected into MAIN world
  popup/               — React UI
lib/
  background/          — service worker modules (state, rpc-handler, rpc, operator-cache, anvil)
  popup/               — React hooks and utils
  shared/              — types, messages, network configs (used by all layers)
test/
  setup.ts             — Chrome API mocks + jest-dom
  fixtures.ts          — makeOperator(), makeState(), address constants
  popup/               — UI component and hook tests
```

## Tech Stack

- WXT (browser extension framework, wraps Vite)
- React (popup UI)
- viem (Ethereum interactions, direct contract reads)
- lido-csm-sdk (ABI + contract addresses only)
- vitest + @testing-library/react (testing)
- oxlint (linting)
- Chrome Extension Manifest V3

## Code Style

- Use `.js` extensions in TypeScript imports (ESM resolution via WXT)
- WXT entry helpers: `defineBackground`, `defineContentScript`, `defineUnlistedScript`
- TypeScript strict mode enabled

## Testing

- `npm run test` / `npm run test:watch` — vitest with jsdom
- Chrome API mocked in `test/setup.ts` (`chrome.runtime`, `chrome.storage`)
- Test fixtures in `test/fixtures.ts` (`makeOperator()`, `makeState()`)
- Tests in `test/popup/` — not type-checked (excluded from tsconfig)
- `npm run test:e2e` — Playwright e2e tests (builds first, runs all `test/e2e/*.e2e.ts`)
- E2E uses raw `playwright` + custom runner (no `@playwright/test` — extensions need `launchPersistentContext`)
- E2E seeds operator data via `sw.evaluate()` into `chrome.storage.local`; wallet state changes go through UI interactions
- E2E helpers in `test/e2e/helpers.ts` (`launchExtension`, `openPopup`, `goToTab`, `seedOperators`, etc.)

## Gotchas

- **BigInt serialization:** `chrome.storage` can't hold BigInts — operator `id` and `curveId` stored as strings, convert back when needed
- **SDK field naming:** lido-csm-sdk uses singular `rewardAddress`/`proposedRewardAddress`, our types use plural `rewardsAddress`/`proposedRewardsAddress` — mapping happens in `operator-cache.ts`
- **Storage split:** `chrome.storage.session` for transient settings (wiped on browser close). Wallet state + operator cache in `chrome.storage.local` (persists)
- **CSM SDK imports:** Contract addresses come from `@lidofinance/lido-csm-sdk/common` subpath, not the main entry
- **Content script timing:** Must run at `document_start` to inject provider before dapp scripts execute
- **CM module:** May not be deployed on all networks — `fetchAllOperators` catches and re-throws after caching empty result
- **Favorites scoping:** Stored as `"moduleType:chainId:operatorId"` (e.g. `"csm:1:42"`). Legacy bare IDs migrated on load.
- **State migration:** `migrateState()` handles legacy storage formats — don't assume storage shape is current

## Related Repos

- `lido-csm-sdk` — SDK for CSM contract interactions (sibling at `../lido-csm-sdk/packages/csm-sdk/`)
- `ethereum-staking-widget` — the dapp this extension tests (sibling at `../ethereum-staking-widget/`)
- `lido-ethereum-sdk` — Lido protocol SDK (sibling at `../lido-ethereum-sdk/packages/sdk/`)

## Docs

- `docs/brainstorms/` — design brainstorms with frontmatter (`date`, `topic`). Consult before implementing features to understand intent and decisions.
