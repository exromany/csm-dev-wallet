# CSM Dev Wallet

Chrome extension for testing the Lido CSM widget. Connect to any dapp as any CSM operator address — no private keys needed.

Injects an EIP-1193 provider (`window.ethereum`) so the dapp sees it as a regular wallet.

## Features

- Browse all CSM/CM operators with search by ID or address
- Connect as manager, rewards, or proposed address
- Favorites operators
- Manual address entry + Anvil built-in accounts
- Optional signing approval modal (Anvil only)
- Configurable RPC endpoints

## Networks

| Network | Signing |
|---------|---------|
| Ethereum Mainnet | Watch-only (signing blocked) |
| Hoodi Testnet | Watch-only (signing blocked) |
| Anvil Local Fork | Full signing via impersonation |

Anvil fork source is auto-detected.

## Install

**Option 1: Pre-built (recommended)**

1. Download the latest `.zip` from [Releases](https://github.com/exromany/csm-dev-wallet/releases)
2. Unzip and load unpacked in `chrome://extensions` (enable Developer mode)

**Option 2: Build from source**

```bash
git clone https://github.com/exromany/csm-dev-wallet.git
cd csm-dev-wallet
npm install
npm run build
```

Load unpacked from `.output/chrome-mv3/`.

## Usage

1. Click extension icon to open popup
2. Select network (top right)
3. Browse operators or switch to Manual tab for arbitrary addresses
4. Click an address to connect — the dapp will see it as the active wallet
5. For signing (transactions, typed data), use an Anvil fork

## Development

Requires Node >= 24.

For dev mode with hot reload: `npm run dev`, load from `.output/chrome-mv3-dev/`.

| Command | Description |
|---------|-------------|
| `npm run dev` | WXT dev mode with hot reload |
| `npm run build` | Production build |
| `npm run test` | Run tests |
| `npm run test:e2e` | Build + Playwright e2e tests |
| `npm run lint` | Lint with oxlint |
| `npm run typecheck` | TypeScript check |
