---
date: 2026-06-04
topic: anvil-prefunded-message-signing
---

# Enable Message Signing for Anvil Pre-Funded Accounts

## What We're Building

Let testers sign off-chain messages (`personal_sign`, `eth_signTypedData_v4`, `eth_signTypedData`, `eth_sign`) against the dapp when an Anvil pre-funded account is selected. Today these methods silently fail because every signing path goes through `anvil_impersonateAccount`, which only forges the `from` field on transactions and does not enable message signing.

Scope is limited to generic message-signing UX (SIWE, EIP-712 permits, etc.) where the signer's identity does not need to be a specific CSM operator. Signing as an operator address is still impossible by design — those addresses have no known private keys.

## Why

The CSM widget exercises message-signing flows (e.g. permits). With the wallet's current behavior, a tester on Anvil cannot complete these flows even though Anvil has 10 pre-funded accounts with well-known private keys available. The UI already exposes those accounts as selectable in the Manual tab; only the RPC routing logic blocks signing.

## Design Decisions

### Discriminate by `source.type`, not address membership

`SelectedAddress.source.type === 'anvil'` is set when the user picks from the Anvil section of the Manual tab. We use that signal — not membership in `eth_accounts` from the live RPC — to decide whether Anvil owns the key.

- Reflects explicit user intent.
- No extra RPC roundtrip on every signing call.
- A manual address that coincidentally matches a pre-funded one will not sign messages. Documented edge case; choose the Anvil section to sign with that key.

### Three-way routing in the signing case

When `chainId === ANVIL_CHAIN_ID` and an address is selected:

```
source.type === 'anvil'?
├─ yes → proxyToRpc(method, params, ANVIL_CHAIN_ID, ...)   // Anvil signs natively
└─ no  → method === 'eth_sendTransaction'?
         ├─ yes → withImpersonation + proxy                // unchanged
         └─ no  → MESSAGE_SIGNING_REQUIRES_ANVIL_ACCOUNT    // clear error
```

The Anvil-account path skips impersonation entirely. Anvil already holds the key; impersonation is unnecessary for transactions and counterproductive for messages.

### Hard error with guidance for non-Anvil signing

Non-Anvil addresses on Anvil still sign transactions via impersonation (unchanged), but message-signing methods return a precise EIP-1193 error pointing the user at the Anvil section in the Manual tab. Prevents cryptic Anvil-side errors leaking to the dapp.

## Files Changed

- **Modified:** `lib/background/rpc-handler.ts`
  - Add `MESSAGE_SIGNING_REQUIRES_ANVIL_ACCOUNT` error constant.
  - Replace the body of the signing-method case with the three-way routing above. `handleAnvilSigning` stays for the impersonation branch.
- **Added tests** in a new `test/background/rpc-handler.test.ts` (no rpc-handler test file exists today; sibling tests live alongside in `test/background/`):
  - Anvil chain + `source.type === 'anvil'` + `personal_sign` → proxies directly, no `anvil_impersonateAccount` call.
  - Anvil chain + `source.type === 'operator'` + `personal_sign` → returns code 4200 with the new message; no RPC call.
  - Anvil chain + `source.type === 'operator'` + `eth_sendTransaction` → unchanged, wrapped in `withImpersonation`.

No changes to `anvil.ts`, `state.ts`, `types.ts`, popup UI, content script, or background entrypoint.

## Out of Scope

- Exposing multiple addresses simultaneously in `eth_accounts`.
- Mnemonic-derived labels for Anvil accounts beyond the existing `#0..#9` index.
- Enabling message signing for operator/manual addresses (would require forking Anvil or rewriting CSM contract storage to grant operator role to a pre-funded account — a separate, much larger initiative).

## Edge Cases (accepted as-is)

- **Anvil restarted with different mnemonic** — selection persists but address may no longer be unlocked. Anvil's native RPC error surfaces. Popup refreshes `anvilStatus.accounts` on next open.
- **`eth_signTransaction`** — not in the handled method list; falls through to the default RPC proxy. Anvil-pre-funded works, operator does not. No widget uses this method today.
