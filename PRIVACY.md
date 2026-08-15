# Privacy Policy

CSM Dev Wallet is a developer/QA tool for testing the Lido CSM widget. It does not collect, transmit, or sell any user data.

## Data storage

All extension state — selected addresses, the operator cache, settings, and favorites — is stored locally in browser extension storage (`chrome.storage`). None of it ever leaves your machine.

## Network requests

The extension makes network requests only to the Ethereum RPC endpoints you configure (defaults are public Lido/Ethereum RPCs), in order to read on-chain CSM operator data. It does not talk to any other service.

## No tracking

There is no analytics, telemetry, tracking, or third-party service integration of any kind.

## Signing

The extension cannot access private keys and cannot sign transactions or messages on real networks — it is watch-only by design. Signing is only available against a local Anvil fork, using Anvil's own impersonation, not real key material.

## Contact

Questions or concerns: open an issue at https://github.com/exromany/csm-dev-wallet/issues.

---

Last updated: 2026-08-15
