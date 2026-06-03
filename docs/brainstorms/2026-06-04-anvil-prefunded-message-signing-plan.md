# Anvil Pre-Funded Message Signing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let testers complete off-chain message-signing flows (`personal_sign`, `eth_signTypedData_v4`) in the CSM widget by selecting an Anvil pre-funded account in the popup.

**Architecture:** Route signing methods in `lib/background/rpc-handler.ts` by `SelectedAddress.source.type`. `'anvil'` source → proxy directly to Anvil (Anvil holds the key, signs natively). Other sources → impersonate for `eth_sendTransaction` (unchanged); return a clear EIP-1193 error for message-signing methods. No UI, state, or type changes — the popup already exposes Anvil accounts as a selectable `source.type === 'anvil'` address.

**Tech Stack:** TypeScript, vitest, viem, WXT (Manifest V3 extension). Tests use `vi.mock` + `vi.hoisted` per existing conventions in `test/background/`.

**Spec:** `docs/brainstorms/2026-06-04-anvil-prefunded-message-signing.md`

---

## File Structure

- **Modify:** `lib/background/rpc-handler.ts` — add error constant, replace body of the signing-method `case` block (lines 91-104).
- **Create:** `test/background/rpc-handler.test.ts` — no existing test file for this module. Covers all three signing routes (anvil-source, message error, tx-impersonation regression) plus a watch-only regression smoke test.

Nothing else changes. `anvil.ts`, `state.ts`, types, popup, content script, and background entrypoint are untouched.

---

## Task 1: Set up `rpc-handler.test.ts` with mocks and one regression test

**Files:**
- Create: `test/background/rpc-handler.test.ts`

- [ ] **Step 1: Create the test file with mocks and one regression test**

The watch-only regression test pins the existing error path so later edits to the switch case can't accidentally break it. It also exercises the mock setup end-to-end before we start adding new behavior.

```ts
// test/background/rpc-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeSiteState, makeGlobalSettings, ADDR_A } from '../fixtures.js';

// ── Mock test-rpc: real NOT_HANDLED symbol, stubbed handler ──
const NOT_HANDLED = Symbol('NOT_HANDLED');
const { mockHandleTestRpc } = vi.hoisted(() => ({ mockHandleTestRpc: vi.fn() }));
vi.mock('../../lib/background/test-rpc.js', () => ({
  handleTestRpc: mockHandleTestRpc,
  NOT_HANDLED,
}));

// ── Mock state ──
const {
  mockGetSiteState,
  mockSetSiteState,
  mockGetGlobalSettings,
  mockNotifyChainChanged,
} = vi.hoisted(() => ({
  mockGetSiteState: vi.fn(),
  mockSetSiteState: vi.fn(),
  mockGetGlobalSettings: vi.fn(),
  mockNotifyChainChanged: vi.fn(),
}));
vi.mock('../../lib/background/state.js', () => ({
  getSiteState: mockGetSiteState,
  setSiteState: mockSetSiteState,
  getGlobalSettings: mockGetGlobalSettings,
  notifyChainChanged: mockNotifyChainChanged,
}));

// ── Mock anvil ──
const { mockWithImpersonation, mockGetForkedFrom } = vi.hoisted(() => ({
  mockWithImpersonation: vi.fn(),
  mockGetForkedFrom: vi.fn(),
}));
vi.mock('../../lib/background/anvil.js', () => ({
  withImpersonation: mockWithImpersonation,
  getForkedFrom: mockGetForkedFrom,
}));

// ── Mock rpc ──
const { mockRawJsonRpc } = vi.hoisted(() => ({ mockRawJsonRpc: vi.fn() }));
vi.mock('../../lib/background/rpc.js', () => ({ rawJsonRpc: mockRawJsonRpc }));

// ── Imports under test ──
import { handleRpcRequest } from '../../lib/background/rpc-handler.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';

const ORIGIN = 'https://stake.lido.fi';

beforeEach(() => {
  vi.clearAllMocks();
  mockHandleTestRpc.mockResolvedValue(NOT_HANDLED);
  mockGetSiteState.mockResolvedValue(makeSiteState());
  mockGetGlobalSettings.mockResolvedValue(makeGlobalSettings());
  mockGetForkedFrom.mockResolvedValue(null);
  mockSetSiteState.mockResolvedValue(undefined);
  mockNotifyChainChanged.mockResolvedValue(undefined);
});

describe('handleRpcRequest — signing methods', () => {
  it('returns watch-only error when chainId is not Anvil', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: 1,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'operator', operatorId: '42', role: 'manager' },
        },
      }),
    );

    const result = await handleRpcRequest('personal_sign', ['0xdead', ADDR_A], ORIGIN);

    expect(result.error?.code).toBe(4200);
    expect(result.error?.message).toMatch(/Watch-only/);
    expect(mockRawJsonRpc).not.toHaveBeenCalled();
    expect(mockWithImpersonation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new test, verify green**

Run: `npm run test -- test/background/rpc-handler.test.ts`
Expected: 1 passed.

- [ ] **Step 3: Run full typecheck**

Run: `npm run typecheck`
Expected: exits 0. (Test files are excluded from tsconfig per CLAUDE.md, but `tsc --noEmit` should still pass for everything else.)

- [ ] **Step 4: Commit**

```bash
git add test/background/rpc-handler.test.ts
git commit -m "test(rpc-handler): scaffold test file with watch-only regression"
```

---

## Task 2: Add the Anvil-source signing path (TDD)

**Files:**
- Modify: `lib/background/rpc-handler.ts` — signing-method case (lines 91-104).
- Modify: `test/background/rpc-handler.test.ts` — add one new test.

- [ ] **Step 1: Write a failing test for `source.type === 'anvil'` + `personal_sign`**

Add this test inside the existing `describe('handleRpcRequest — signing methods', () => { ... })` block in `test/background/rpc-handler.test.ts`:

```ts
  it('proxies personal_sign directly when source.type === "anvil"', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: ANVIL_CHAIN_ID,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'anvil', index: 0 },
        },
      }),
    );
    mockRawJsonRpc.mockResolvedValue({ result: '0xsignature' });

    const result = await handleRpcRequest('personal_sign', ['0xdead', ADDR_A], ORIGIN);

    expect(result).toEqual({ result: '0xsignature' });
    expect(mockWithImpersonation).not.toHaveBeenCalled();
    // Only the personal_sign call — no anvil_impersonateAccount round-trip.
    expect(mockRawJsonRpc).toHaveBeenCalledTimes(1);
    expect(mockRawJsonRpc).toHaveBeenCalledWith(
      expect.any(String),
      'personal_sign',
      ['0xdead', ADDR_A],
    );
  });
```

- [ ] **Step 2: Run the new test, verify it fails (red)**

Run: `npm run test -- test/background/rpc-handler.test.ts`
Expected: 1 passed, 1 failed. The new test fails because the current handler routes all Anvil signing through `withImpersonation`, so `mockWithImpersonation` was called and `mockRawJsonRpc` was not called directly.

- [ ] **Step 3: Implement the Anvil-source branch**

In `lib/background/rpc-handler.ts`, replace the body of the signing-method case (currently lines 91-104). Old code:

```ts
    case 'eth_sendTransaction':
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData':
    case 'personal_sign':
    case 'eth_sign': {
      if (!siteState.selectedAddress) {
        return { error: NOT_CONNECTED_ERROR };
      }
      if (siteState.chainId !== ANVIL_CHAIN_ID) {
        return { error: WATCH_ONLY_ERROR };
      }
      const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
      return handleAnvilSigning(method, params, siteState.selectedAddress.address, rpcUrl);
    }
```

New code (only the Anvil-source short-circuit added; rest unchanged):

```ts
    case 'eth_sendTransaction':
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData':
    case 'personal_sign':
    case 'eth_sign': {
      if (!siteState.selectedAddress) {
        return { error: NOT_CONNECTED_ERROR };
      }
      if (siteState.chainId !== ANVIL_CHAIN_ID) {
        return { error: WATCH_ONLY_ERROR };
      }
      const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
      // Anvil owns the pre-funded account's key — sign natively, no impersonation.
      if (siteState.selectedAddress.source.type === 'anvil') {
        return proxyToRpc(method, params, ANVIL_CHAIN_ID, { [ANVIL_CHAIN_ID]: rpcUrl });
      }
      return handleAnvilSigning(method, params, siteState.selectedAddress.address, rpcUrl);
    }
```

- [ ] **Step 4: Run tests, verify green**

Run: `npm run test -- test/background/rpc-handler.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/background/rpc-handler.ts test/background/rpc-handler.test.ts
git commit -m "feat(rpc): sign natively for Anvil pre-funded accounts

Skip anvil_impersonateAccount when SelectedAddress.source.type === 'anvil'.
Anvil holds the key and signs both transactions and messages directly."
```

---

## Task 3: Error out cleanly when non-Anvil source requests message signing (TDD)

**Files:**
- Modify: `lib/background/rpc-handler.ts` — add error constant + new branch.
- Modify: `test/background/rpc-handler.test.ts` — add one new test.

- [ ] **Step 1: Write a failing test for non-Anvil source + `personal_sign`**

Add this test inside the existing `describe('handleRpcRequest — signing methods', () => { ... })` block:

```ts
  it('returns a clear error for personal_sign when source is not "anvil"', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: ANVIL_CHAIN_ID,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'operator', operatorId: '42', role: 'manager' },
        },
      }),
    );

    const result = await handleRpcRequest('personal_sign', ['0xdead', ADDR_A], ORIGIN);

    expect(result.error?.code).toBe(4200);
    expect(result.error?.message).toMatch(/Anvil pre-funded account/);
    expect(mockWithImpersonation).not.toHaveBeenCalled();
    expect(mockRawJsonRpc).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the new test, verify it fails (red)**

Run: `npm run test -- test/background/rpc-handler.test.ts`
Expected: 2 passed, 1 failed. The new test fails because the current handler still calls `withImpersonation` for operator source.

- [ ] **Step 3: Add the error constant and the non-Anvil branch**

In `lib/background/rpc-handler.ts`, add a new error constant alongside the existing two (around line 17, after `NOT_CONNECTED_ERROR`):

```ts
const MESSAGE_SIGNING_REQUIRES_ANVIL_ACCOUNT = {
  code: 4200,
  message:
    'CSM Dev Wallet: Message signing requires an Anvil pre-funded account. ' +
    'Pick one from the Anvil section in the Manual tab.',
};
```

Then update the signing-method case body so the full version (including the new branch) reads:

```ts
    case 'eth_sendTransaction':
    case 'eth_signTypedData_v4':
    case 'eth_signTypedData':
    case 'personal_sign':
    case 'eth_sign': {
      if (!siteState.selectedAddress) {
        return { error: NOT_CONNECTED_ERROR };
      }
      if (siteState.chainId !== ANVIL_CHAIN_ID) {
        return { error: WATCH_ONLY_ERROR };
      }
      const rpcUrl = globalSettings.customRpcUrls[ANVIL_CHAIN_ID] ?? ANVIL_NETWORK.rpcUrl;
      // Anvil owns the pre-funded account's key — sign natively, no impersonation.
      if (siteState.selectedAddress.source.type === 'anvil') {
        return proxyToRpc(method, params, ANVIL_CHAIN_ID, { [ANVIL_CHAIN_ID]: rpcUrl });
      }
      // Non-Anvil addresses: impersonation forges `from` on transactions but
      // cannot produce signatures. Bail out clearly for message-signing methods.
      if (method !== 'eth_sendTransaction') {
        return { error: MESSAGE_SIGNING_REQUIRES_ANVIL_ACCOUNT };
      }
      return handleAnvilSigning(method, params, siteState.selectedAddress.address, rpcUrl);
    }
```

- [ ] **Step 4: Run tests, verify green**

Run: `npm run test -- test/background/rpc-handler.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/background/rpc-handler.ts test/background/rpc-handler.test.ts
git commit -m "feat(rpc): clear error when non-Anvil source requests message signing

Anvil's anvil_impersonateAccount forges the tx 'from' field but cannot
produce signatures. Return EIP-1193 error 4200 with guidance pointing the
user at the Anvil section in the Manual tab instead of leaking Anvil's
native error."
```

---

## Task 4: Pin the unchanged impersonation path with a regression test

**Files:**
- Modify: `test/background/rpc-handler.test.ts` — add one test.

This task has no production-code change. It documents the intended behavior so a future edit can't silently break transaction impersonation for operator addresses.

- [ ] **Step 1: Write the regression test**

Add this test inside the same `describe('handleRpcRequest — signing methods', () => { ... })` block:

```ts
  it('routes eth_sendTransaction through withImpersonation for operator source', async () => {
    mockGetSiteState.mockResolvedValue(
      makeSiteState({
        chainId: ANVIL_CHAIN_ID,
        selectedAddress: {
          address: ADDR_A,
          source: { type: 'operator', operatorId: '42', role: 'manager' },
        },
      }),
    );
    // withImpersonation receives a fn() to execute under impersonation; we
    // run that fn to verify the inner proxy call happens.
    mockWithImpersonation.mockImplementation(async (_rpc, _addr, fn) => fn());
    mockRawJsonRpc.mockResolvedValue({ result: '0xtxhash' });

    const result = await handleRpcRequest(
      'eth_sendTransaction',
      [{ from: ADDR_A, to: ADDR_A, value: '0x0' }],
      ORIGIN,
    );

    expect(result).toEqual({ result: '0xtxhash' });
    expect(mockWithImpersonation).toHaveBeenCalledTimes(1);
    expect(mockWithImpersonation).toHaveBeenCalledWith(
      expect.any(String),
      ADDR_A,
      expect.any(Function),
    );
    expect(mockRawJsonRpc).toHaveBeenCalledWith(
      expect.any(String),
      'eth_sendTransaction',
      [{ from: ADDR_A, to: ADDR_A, value: '0x0' }],
    );
  });
```

- [ ] **Step 2: Run tests, verify green (should pass on first run)**

Run: `npm run test -- test/background/rpc-handler.test.ts`
Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add test/background/rpc-handler.test.ts
git commit -m "test(rpc-handler): pin tx-impersonation path for operator source"
```

---

## Task 5: Final checks

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: all green, including the four new tests in `rpc-handler.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds successfully into `.output/chrome-mv3/`.

- [ ] **Step 5: Manual smoke test (optional, requires running Anvil)**

If a local Anvil fork is available:
1. `anvil --fork-url <mainnet-rpc>` in a terminal.
2. Load the dev build into `chrome://extensions` from `.output/chrome-mv3-dev/`.
3. Open the popup, switch to Anvil network, open the Manual tab.
4. Select an account from the "Anvil accounts (pre-funded)" section.
5. On the dapp, trigger a SIWE login or EIP-712 permit. Confirm the signature is returned to the dapp without error.
6. Switch to an operator address. Trigger the same flow. Confirm the dapp sees error code 4200 with the "Pick one from the Anvil section" message.
7. Switch back to an operator address. Trigger `eth_sendTransaction` (e.g., add bond). Confirm it still works.

No commit needed for the smoke test.

---

## Notes for the Implementer

- **Test file conventions:** `test/background/*.test.ts` is vitest with jsdom. Chrome APIs are mocked in `test/setup.ts`; fixtures (`makeSiteState`, `ADDR_A`, etc.) live in `test/fixtures.ts`. Mock other background modules with `vi.mock` + `vi.hoisted` as shown — see `test/background/test-rpc.test.ts` for the canonical pattern.
- **TypeScript imports:** Use `.js` extensions in `import` paths even for `.ts` source — WXT's ESM resolution requires it (per CLAUDE.md).
- **Commit hygiene:** Each task ends with a commit. Don't squash; the per-task history is useful for review and bisect.
- **Out-of-scope edits:** Don't touch `anvil.ts`, the popup, or the content script. The plumbing for `source.type === 'anvil'` is already there end-to-end.
