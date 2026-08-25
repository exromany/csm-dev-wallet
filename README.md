# CSM Dev Wallet

Chrome extension for testing the Lido CSM widget. Connect to any dapp as any CSM operator address — no private keys needed.

Injects an EIP-1193 provider (`window.ethereum`) so the dapp sees it as a regular wallet.

See [PRIVACY.md](./PRIVACY.md) for the privacy policy.

## Features

- Browse all CSM / CSM 0x02 / CM operators with search by ID or address
- Connect as manager, rewards, or proposed address
- Favorites operators
- Manual address entry (Manual tab) + Anvil pre-funded accounts (Anvil tab, fork only)
- Optional signing approval modal (Anvil only)
- Configurable RPC endpoints

## Networks

| Network | Signing |
|---------|---------|
| Ethereum Mainnet | Watch-only (signing blocked) |
| Hoodi Testnet | Watch-only (signing blocked) |
| Anvil Local Fork | See signing matrix below |

Anvil fork source is auto-detected.

### Signing on Anvil

Impersonation forges a transaction's `from` field but can't produce real signatures, so message signing needs an account whose key Anvil actually holds.

| Account type | Transactions | Message signing (`personal_sign`, typed data) |
|--------------|--------------|------------------------------------------------|
| Operator address (impersonated) | ✅ | ❌ — error 4200, pick an Anvil account instead |
| Anvil pre-funded (Anvil tab) | ✅ native | ✅ native |

## Install

**Option 1: Chrome Web Store (recommended)**

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/csm-dev-wallet/makdjhggppfdjnjfgghgmekcenfekmfg) — auto-updates, no Developer mode needed.

**Option 2: Pre-built zip**

Download the latest `.zip` from [Releases](https://github.com/exromany/csm-dev-wallet/releases) and load it as an unpacked extension. Use this for Firefox, or to get a build ahead of store review.

### Chrome / Chromium

```bash
curl -sL https://github.com/exromany/csm-dev-wallet/releases/download/latest/csm-dev-wallet.zip -o /tmp/csm-dev-wallet.zip && unzip -o /tmp/csm-dev-wallet.zip -d ~/csm-dev-wallet
```

Then load unpacked from `~/csm-dev-wallet` in `chrome://extensions` (enable Developer mode). Re-run to update, then click the reload icon.

### Firefox (140+)

```bash
curl -sL https://github.com/exromany/csm-dev-wallet/releases/download/latest/csm-dev-wallet-firefox.zip -o /tmp/csm-dev-wallet-firefox.zip && unzip -o /tmp/csm-dev-wallet-firefox.zip -d ~/csm-dev-wallet-firefox
```

Then in `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `manifest.json` from `~/csm-dev-wallet-firefox`. Note: Firefox unloads temporary extensions on browser restart.

**Option 3: Build from source**

```bash
git clone https://github.com/exromany/csm-dev-wallet.git
cd csm-dev-wallet
pnpm install
pnpm run build          # Chrome → .output/chrome-mv3/
pnpm run build:firefox  # Firefox → .output/firefox-mv3/
```

## Usage

1. Click extension icon to open popup
2. Select network (top right)
3. Browse operators, or switch to the Manual tab for arbitrary addresses (Anvil tab for pre-funded accounts, fork only)
4. Click an address to connect — the dapp will see it as the active wallet
5. For transactions, use an Anvil fork; for message signing (`personal_sign`, typed data), connect via the Anvil tab

## Development

Requires Node >= 24.

For dev mode with hot reload: `pnpm run dev`, load from `.output/chrome-mv3-dev/`.

| Command | Description |
|---------|-------------|
| `pnpm run dev` | WXT dev mode with hot reload |
| `pnpm run build` | Production build |
| `pnpm run test` | Run tests |
| `pnpm run test:e2e` | Build + Playwright e2e tests |
| `pnpm run lint` | Lint with oxlint |
| `pnpm run typecheck` | TypeScript check |
| `pnpm run build:package` | Build extension + playwright helpers → dist/ |

## Playwright Testing API

This extension ships as an npm package with a Playwright helper for dapp e2e tests. Install it and get a programmable wallet with zero manual interaction.

### Launch

```typescript
import { launch } from 'csm-dev-wallet/playwright';

const { context, wallet } = await launch();
// For local dev: launch({ extensionPath: '.output/chrome-mv3' })
```

`launch()` starts Chromium with the extension loaded and returns a `WalletController` bound to the service worker.

### Setup (before page navigation)

Talks directly to the service worker — call before navigating to the dapp.

```typescript
await wallet.setup({
  origin: 'http://localhost:3000',
  network: 1,                        // chainId
  account: '0x...',                  // auto-connects, no popup
  signingMode: 'approve',           // 'approve' | 'reject' | 'error' | 'prompt'
  operators: [...],                  // optional: seed operator cache
  moduleAvailability: { csm: true, cm: false }, // optional
});
```

### Page control (mid-test)

These methods call `wallet_test*` RPC via `window.ethereum` on the given page.

```typescript
await wallet.switchAccount(page, '0xNew');     // emits accountsChanged
await wallet.switchNetwork(page, 560048);      // emits chainChanged
await wallet.setSigningMode(page, 'reject');   // next sign → 4001
await wallet.disconnect(page);                 // emits accountsChanged([])
const state = await wallet.getState(page);     // current wallet state
```

### Operator queries (mid-test)

Read cached operators, look up a single operator, or select an account by operator+role.

```typescript
const ops = await wallet.getOperators(page);              // all cached operators
const ops = await wallet.getOperators(page, 560048, 'cm'); // explicit chain/module

const op = await wallet.getOperator(page, '42');           // single operator by ID

await wallet.selectOperator(page, '42', 'manager');        // set manager address as active
await wallet.selectOperator(page, '42', 'rewards');        // set rewards address
await wallet.selectOperator(page, '42', 'proposedManager'); // set proposed manager
```

### RPC & operator refresh (mid-test)

Configure RPC endpoints and refresh operator data from chain.

```typescript
await wallet.setRpcUrl(page, 1, 'https://my-rpc.example.com');   // set mainnet RPC
await wallet.setRpcUrl(page, 31337, 'http://127.0.0.1:9545');    // set anvil RPC

const ops = await wallet.refreshOperators(page);                  // refetch from RPC
const ops = await wallet.refreshOperators(page, 560048, 'cm');    // explicit chain/module
const ops = await wallet.refreshOperators(page, 1, 'csm', rpcUrl); // with RPC override
```

### Signing modes

| Mode | Behavior |
|---|---|
| `approve` | Auto-sign via Anvil impersonation, no popup |
| `reject` | Auto-reject with code 4001 (user denied) |
| `error` | Simulate RPC failure with code -32603 |
| `prompt` | Normal popup behavior (default) |

### Custom RPC methods

Available on `window.ethereum` when the extension is loaded:

| Method | Params | Effect |
|---|---|---|
| `wallet_testGetState` | — | Returns composed wallet state |
| `wallet_testConnect` | `{ address?, source? }` | Connect with optional address |
| `wallet_testDisconnect` | — | Disconnect, emit accountsChanged([]) |
| `wallet_testSetAccount` | `{ address, source? }` | Switch address, emit accountsChanged |
| `wallet_testSetNetwork` | `{ chainId }` | Switch chain, emit chainChanged |
| `wallet_testSetSigningMode` | `{ mode }` | Set signing behavior |
| `wallet_testSeedOperators` | `{ operators, chainId, moduleType }` | Inject operator cache |
| `wallet_testGetOperators` | `{ chainId?, moduleType? }` | Get cached operators (defaults from site state) |
| `wallet_testGetOperator` | `{ operatorId, chainId?, moduleType? }` | Get single operator by ID |
| `wallet_testSetOperatorAccount` | `{ operatorId, role, chainId?, moduleType? }` | Select operator address by role |
| `wallet_testSetRpcUrl` | `{ chainId, rpcUrl }` | Set custom RPC URL for a chain |
| `wallet_testRefreshOperators` | `{ chainId?, moduleType?, rpcUrl? }` | Refetch operators from RPC |
