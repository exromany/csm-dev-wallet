---
date: 2026-02-17
topic: remove-keys-anvil-impersonation-cm-visibility
---

# Remove Private Keys, Anvil Impersonation, RPC Fix, CM Visibility

## What We're Building

Four related changes to simplify the wallet and make Anvil testing seamless:

1. **Remove private key import** — wallet becomes purely watch-only
2. **Fix RPC settings save bug** — empty strings and Anvil custom URLs
3. **Anvil impersonation** — sign transactions via `anvil_impersonateAccount`
4. **Hide CM module** — when not deployed on current network (changed to disable instead hiding)

## Why

Private key import was a liability for a QA tool — testers shouldn't handle keys at all. Anvil impersonation gives the same signing capability without any key management. The RPC bug was blocking custom URLs on Anvil. CM visibility prevents confusing empty state on networks where CM isn't deployed.

## Design Decisions

### Signing is network-based, not per-address
Old model: `canSign` boolean per address (has imported key or not).
New model: on Anvil = all addresses can sign via impersonation; elsewhere = watch-only.

This eliminated the `canSign` field from `SelectedAddress`, the key store, and all related UI.

### Impersonation wraps proxy
Instead of building a separate wallet client for Anvil signing, we impersonate the account and proxy the raw RPC method. One code path for all signing methods.

```
signing method → chainId === 31337?
  yes → impersonate → proxy to Anvil → stop impersonating
  no  → error 4200 (watch-only)
```

### Module availability is fire-and-forget
`checkModuleAvailability` is called without `await` so it doesn't block operator loading. Popup defaults to showing both modules, hides CM once the check completes.

### customRpcUrls widened to `Record<number, string>`
Was `Record<SupportedChainId, string>` — Anvil's 31337 wasn't a valid key. Now any chain ID works.

## Files Changed

- **Deleted:** `lib/background/key-store.ts`
- **Modified:** `rpc-handler.ts` (new Anvil signing flow), `anvil.ts` (withImpersonation), `operator-cache.ts` (isModuleAvailable), `background.ts`, `messages.ts`, `types.ts`, `App.tsx`, `ManualAddresses.tsx`, `ConnectedBar.tsx`, `ModuleSelector.tsx`, `hooks.ts`
