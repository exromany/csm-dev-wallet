# Chrome Web Store listing

Reference material for filling out the Chrome Web Store developer dashboard.

## Listing copy

**Short description** (reuses the manifest description):

> QA wallet for Lido CSM widget — connect as any operator address

**Detailed description:**

CSM Dev Wallet emulates an Ethereum wallet — injecting an EIP-1193 provider (`window.ethereum`) and announcing itself via EIP-6963 — so you can manually QA the Lido CSM widget without a real wallet or private keys. Browse all CSM operators, then connect to the dapp under test as any operator's manager, rewards, or proposed address, watch-only. Point it at a local Anvil fork to additionally sign transactions and messages via Anvil account impersonation.

This extension is built for QA engineers and developers testing the Lido CSM widget and similar dapps. It holds no real private keys and cannot move real funds — all signing on public networks is blocked by design.

## Single purpose statement

Lets a tester connect to a dapp as any Lido CSM operator address for QA purposes, without needing that operator's private key.

## Permission justifications

Paste-ready, one per dashboard field.

**Host permissions (`<all_urls>`) + content script:**

> The extension injects an EIP-1193 wallet provider (window.ethereum + EIP-6963 announce) at document_start so dapps under test can detect it. Dapps under test run on arbitrary origins including localhost and ephemeral preview deployments, so the origin list cannot be enumerated. No page data is read or collected.

**`storage`:**

> Caches CSM operator lists per network and persists wallet/UI state locally.

**`activeTab`:**

> Reads the current tab's URL when the popup opens to show per-site connection state.

## Privacy form answers

- Does this extension collect any user data? **No.**
- Does this extension use remote code? **No.**

See [PRIVACY.md](../PRIVACY.md) for the full policy.

## Recommended visibility

**Unlisted** — the audience is internal QA, not the general public. Publish from a Lido-owned developer account to avoid trademark friction over the "CSM"/"Lido" naming.

## Assets checklist

- [x] 128px icon — `public/icon-128.png`
- [ ] At least one screenshot, 1280×800 — generate via `pnpm run screenshot:store`, output lands in `docs/store/`
- [ ] Privacy policy URL — link to [PRIVACY.md](../PRIVACY.md) on GitHub
