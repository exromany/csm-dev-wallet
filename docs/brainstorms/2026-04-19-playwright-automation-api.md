---
date: 2026-04-19
topic: Playwright automation API for dapp testing
---

# Playwright Automation API

## Goal

Make csm-dev-wallet a programmable fake wallet for Playwright-based dapp e2e tests. Published as an npm package — consumers install it, import the Playwright helpers, and get a controllable wallet with zero manual interaction.

## Use Cases

- Testing dapps (e.g. ethereum-staking-widget) against Anvil forks with full signing
- Watch-only testing against Hoodi testnet
- Mid-test control: switch accounts, networks, disconnect, simulate signing failures

## Approach: Lean RPC + Existing Mechanisms

The extension already handles auto-connect (pre-seeded `siteState` with `isConnected: true`). We add a thin RPC control plane for mid-test control (including a `signingMode` that supersedes the existing `requireApproval` setting) and wrap everything in a Playwright API.

Two communication channels:
- **Service worker** (`sw.evaluate()`) — setup before any page exists
- **Page** (`page.evaluate()`) — custom RPC methods via injected `window.ethereum`

## Custom RPC Methods

Called from dapp page via `window.ethereum.request()`. The service worker handles them in the RPC handler, scoped to the caller's origin. Each triggers appropriate EIP-1193 events.

### State Control

| Method | Params | Effect |
|---|---|---|
| `wallet_testSetAccount` | `{ address, source? }` | Set selected address, emit `accountsChanged` |
| `wallet_testSetNetwork` | `{ chainId }` | Switch chain, emit `chainChanged` |
| `wallet_testConnect` | `{ address?, source? }` | Mark connected, optionally set address |
| `wallet_testDisconnect` | — | Clear connection, emit `accountsChanged([])` |
| `wallet_testGetState` | — | Return current composed state snapshot |

### Signing Control

| Method | Params | Effect |
|---|---|---|
| `wallet_testSetSigningMode` | `{ mode }` | Set signing behavior |

Modes:
- `approve` — auto-sign via Anvil impersonation, no popup
- `reject` — auto-reject with code `4001` (user denied)
- `error` — simulate RPC failure with code `-32603`
- `prompt` — normal popup behavior (default)

Signing mode is **in-memory only** — resets to `prompt` on service worker restart.

### Data Seeding

| Method | Params | Effect |
|---|---|---|
| `wallet_testSeedOperators` | `{ operators, chainId, moduleType }` | Inject into operator cache |

## Extension Changes

Three touch points, minimal surgery:

### 1. New: `lib/background/test-rpc.ts`

Handles all `wallet_test*` methods. Returns a sentinel to distinguish "handled" from "not a test method":

```typescript
const NOT_HANDLED = Symbol('not-handled');

handleTestRpc(origin: string, method: string, params?: unknown[]): unknown | typeof NOT_HANDLED
```

Returns `NOT_HANDLED` for non-test methods (caller falls through). Test methods with no meaningful return (e.g. `wallet_testDisconnect`) return `null`. Calls existing state functions: `setSiteState()`, `notifyAccountsChanged()`, `notifyChainChanged()`, `setOperatorCache()`.

Exports `signingMode` for the signing flow to read.

### 2. Modified: `lib/background/rpc-handler.ts`

One routing line at the top of `handleRpcRequest()`:

```typescript
const testResult = handleTestRpc(origin, method, params);
if (testResult !== NOT_HANDLED) return testResult;
```

### 3. Modified: `entrypoints/background.ts`

In `handleWithApproval()`, check `signingMode` before opening the approval popup:

- `'approve'` → skip popup, execute directly
- `'reject'` → return error `4001`
- `'error'` → return error `-32603`
- `'prompt'` → existing popup behavior

### No changes to:

`content.ts`, `inpage.ts`, popup UI, shared types. The content script already forwards all RPC methods transparently.

## Playwright API

### Launch

```typescript
import { launch } from 'csm-dev-wallet/playwright';

const { context, wallet } = await launch();
// Extension path auto-resolved from the installed package
// Optional: launch({ extensionPath: './local-build' }) for dev
```

### Setup (service worker, no page needed)

```typescript
await wallet.setup({
  origin: 'http://localhost:3000',
  network: 1,
  account: '0xManagerAddress',
  signingMode: 'approve',
  operators: [...],                          // optional
  moduleAvailability: { csm: true, cm: false }, // optional
});
```

Pre-seeds `siteState` and `globalSettings` via `sw.evaluate()`. After this, the dapp's `eth_requestAccounts` returns the configured address immediately — no popup.

### Page Methods (custom RPC, needs page)

```typescript
const page = await context.newPage();
await page.goto('http://localhost:3000');

await wallet.switchAccount(page, '0xNewAddress');    // accountsChanged
await wallet.switchNetwork(page, 560048);            // chainChanged
await wallet.setSigningMode(page, 'reject');         // next sign → 4001
await wallet.disconnect(page);                       // accountsChanged([])
const state = await wallet.getState(page);           // state snapshot
```

### Consumer Fixture Example

```typescript
import { test as base } from '@playwright/test';
import { launch } from 'csm-dev-wallet/playwright';

const test = base.extend({
  walletContext: async ({}, use) => {
    const { context, wallet } = await launch();
    await use({ context, wallet });
    await context.close();
  },
});
```

## npm Package

### Build Pipeline

1. `wxt build` → `.output/chrome-mv3/`
2. `tsup playwright/index.ts` → `dist/playwright/`
3. Copy `.output/chrome-mv3/` → `dist/extension/`
4. `npm publish` ships `dist/`

### Package Layout

```
dist/
  extension/              — pre-built chrome-mv3
  playwright/
    index.mjs             — compiled helpers
    index.d.ts            — type declarations
    wallet-controller.mjs
    types.mjs
```

### package.json

```json
{
  "name": "csm-dev-wallet",
  "files": ["dist/"],
  "exports": {
    "./playwright": {
      "types": "./dist/playwright/index.d.ts",
      "import": "./dist/playwright/index.mjs"
    }
  }
}
```

### Auto-resolved Extension Path

```typescript
const DEFAULT_EXTENSION_PATH = resolve(__dirname, '../extension');

export function launch(options?: { extensionPath?: string }) {
  const extensionPath = options?.extensionPath ?? DEFAULT_EXTENSION_PATH;
  // chromium.launchPersistentContext with --load-extension
}
```

`extensionPath` override available for local dev against `.output/chrome-mv3-dev/`.
