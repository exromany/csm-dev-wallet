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
- **Owner indicator:** Not a separate address — `extendedManagerPermissions` alone decides it, so exactly one of MGR/RWD is the owner. Never infer it by comparing addresses: manager and rewards can be the same address and both would match.

## Commands

```bash
pnpm run prepare        # Generate WXT types (.wxt/ directory)
pnpm run dev            # WXT dev mode with hot reload
pnpm run build          # Production build → .output/chrome-mv3/
pnpm run zip            # Build + zip for distribution
pnpm run test           # vitest single run
pnpm run test:watch     # vitest watch mode
pnpm run test:e2e       # build + Playwright e2e suite (all *.e2e.ts files)
pnpm run lint           # oxlint
pnpm run typecheck      # tsc --noEmit
pnpm run build:package  # build extension + playwright helpers → dist/
```

Requires Node >=24. Load unpacked from `.output/chrome-mv3-dev/` (dev) or `.output/chrome-mv3/` (prod) in `chrome://extensions`.

## File Structure

```
entrypoints/
  background.ts        — service worker (WXT defineBackground)
  content.ts           — content script bridge (WXT defineContentScript)
  inpage.ts            — EIP-1193 provider injected into MAIN world
  popup/               — React UI
    SharedAddresses.tsx  — Shared tab: addresses attached to >1 operator, across modules
lib/
  background/          — service worker modules (state, rpc-handler, rpc, operator-cache, anvil)
  popup/               — React hooks and utils
  shared/              — types, messages, network configs (used by all layers)
    attachments.ts       — address → attachments reverse index (across all module caches)
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

- `pnpm run test` / `pnpm run test:watch` — vitest with jsdom
- Chrome API mocked in `test/setup.ts` (`chrome.runtime`, `chrome.storage`)
- Test fixtures in `test/fixtures.ts` (`makeOperator()`, `makeState()`)
- Tests in `test/popup/` — not type-checked (excluded from tsconfig)
- `pnpm run test:e2e` — Playwright e2e tests (builds first, runs all `test/e2e/*.e2e.ts`)
- E2E uses raw `playwright` + custom runner (no `@playwright/test` — extensions need `launchPersistentContext`)
- E2E seeds operator data via `sw.evaluate()` into `chrome.storage.local`; wallet state changes go through UI interactions
- E2E helpers in `test/e2e/helpers.ts` (`launchExtension`, `openPopup`, `goToTab`, `seedOperators`, etc.)

## Release & CI

`.github/workflows/release.yml` runs on **every push to `main`**: lint, typecheck, test, build,
GitHub release (versioned tag + a moving `latest`), npm publish, then Chrome Web Store submit.

- **Store submit is gated on a version bump** — `package.json` version at `HEAD` vs `HEAD^`
  (hence `fetch-depth: 2` on checkout). The Web Store rejects re-uploading an existing version,
  and this workflow fires on every main push, so an ungated step would fail most runs.
- **It auto-publishes, not drafts.** A version bump merged to `main` reaches real users once
  review passes. There is no manual gate.
- Chrome Web Store **API v2 + service account**, via `publish-browser-extension`. Four repo
  secrets: `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`,
  `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`. All config is
  read from `env:` — never pass credentials as CLI flags.
- The v1.1 `CHROME_CLIENT_ID`/`CHROME_REFRESH_TOKEN` OAuth flow is deprecated; its refresh
  tokens die after 7 days unless the OAuth consent screen is published. Don't go back to it.
- npm publish is separately guarded by an `npm view` existence check, so it is safe to re-run.
- Dry-run credentials without touching the listing:
  `npx publish-extension --dry-run --chrome-zip .output/*-chrome.zip`.
  `npx publish-extension status` reads the live published/in-review state.
- Setup details and secret provenance: `docs/store-listing.md`.

## Gotchas

- **BigInt serialization:** `chrome.storage` can't hold BigInts — operator `id` and `curveId` stored as strings, convert back when needed
- **SDK field naming:** lido-csm-sdk uses singular `rewardAddress`/`proposedRewardAddress`, our types use plural `rewardsAddress`/`proposedRewardsAddress` — mapping happens in `operator-cache.ts`
- **Storage split:** `chrome.storage.session` for transient settings (wiped on browser close). Wallet state + operator cache in `chrome.storage.local` (persists)
- **CSM SDK imports:** Contract addresses come from `@lidofinance/lido-csm-sdk/common` subpath, not the main entry
- **Content script timing:** Must run at `document_start` to inject provider before dapp scripts execute
- **CM module:** May not be deployed on all networks — `fetchAllOperators` catches and re-throws after caching empty result
- **Modules:** `lib/shared/modules.ts` is the registry — `MODULE_ORDER` (display order), `BASELINE_MODULE`, the derived `PROBED_MODULES`, and the `MODULE_LABEL`/`MODULE_SHORT` names. Add a module there, not in a local array: background probing, the picker, and the Shared tab all read from it. CSM is the baseline — assumed available everywhere and the fallback the popup switches to; only the others are RPC-probed. CSM 0x02 is Hoodi-only, so `MODULE_CONFIG[CSM_02][mainnet]` is undefined — lookups must tolerate a missing per-chain config. Its SDK operator type is `CSM2_DEF`, not `CSM_02_DEF`
- **Module availability:** `ModuleAvailability` is a `Partial<Record<ModuleType, boolean>>`; a value persisted before a module existed omits that key, so `undefined` means "not known yet", never "absent". Consumers must wait for every `PROBED_MODULES` entry to answer rather than checking the map is non-empty
- **Favorites scoping:** Stored as `"moduleType:chainId:operatorId"` (e.g. `"csm:1:42"`). Legacy bare IDs migrated on load.
- **State migration:** `migrateLegacy()` in `lib/background/state.ts` handles legacy storage formats — don't assume storage shape is current
- **Operator identity is (id, module):** CSM #7 and CM #7 are different operators. Anything
  comparing operators across modules — the Shared tab, `buildAttachmentIndex` — must key on the
  pair, never the bare id.
- **Proposed roles are attachments:** `P-MGR`/`P-RWD` count in `buildAttachmentIndex`, which is
  what the Shared tab's Pending filter selects on. `CLM` (claimer) is a plain role pill — never
  owner, never proposed; Claimer filter on Operators and Shared tabs selects on it.
- **SMDiscovery legacy ABI:** the upgraded impl (with `claimerAddress`) isn't live on every
  network. `readOperatorBatch` reads with `SMDiscoveryAbi` and falls back to `SMDiscoveryV1Abi`
  on a decode error; legacy rows have no claimer. Don't drop the fallback until all networks are
  upgraded.
- **Settings is not a tab:** six tabs overflow the 400px popup, so it lives as a row inside the
  network/module popover. `goToTab(page, 'Settings')` in the e2e helpers opens `.netmod-chip`
  and clicks `.netmod-option.settings`.
- **Shared tab spans every module:** it issues `request-operators` for each available module and
  stays in its loading state until all answer, so counts never render half-built.
- **`.attach-row` is not unique:** `AttachmentRow` renders on the Shared tab *and* in the
  connected bar's hover panel, whose copies sit in the DOM permanently and hidden. Scope e2e
  waits to the owning card — an unscoped `waitForSelector('.attach-row')` can latch onto a
  hidden panel row and hang.
- **Connected address, not connected operator:** the extension only knows the address it exposed
  to the dapp — the widget resolves that address to an operator on its own. `operatorId` in
  `AddressSource` records the provenance of the click, not what's active; no UI may claim a
  specific operator is currently in use.

## Playwright Testing API

Consumer-facing docs (API, signing modes, RPC methods) live in **README.md** and JSDoc on `playwright/types.ts` — both ship with the npm package.

### Key files

- `playwright/` — helper package source (types, wallet-controller, launch)
- `lib/background/test-rpc.ts` — wallet_test* RPC handler
- `test/e2e/playwright-api.e2e.ts` — e2e tests for the API

## Related Repos

- `lido-csm-sdk` — SDK for CSM contract interactions (sibling at `../lido-csm-sdk/packages/csm-sdk/`)
- `ethereum-staking-widget` — the dapp this extension tests (sibling at `../ethereum-staking-widget/`)
- `lido-ethereum-sdk` — Lido protocol SDK (sibling at `../lido-ethereum-sdk/packages/sdk/`)

## Docs

- `docs/brainstorms/` — design brainstorms with frontmatter (`date`, `topic`). Consult before implementing features to understand intent and decisions.
