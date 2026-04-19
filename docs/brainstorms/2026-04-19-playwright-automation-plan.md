# Playwright Automation API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom RPC test methods to the extension's service worker and ship a Playwright helper package so consumer repos can programmatically drive the wallet in dapp e2e tests.

**Architecture:** A new `test-rpc.ts` module handles `wallet_test*` RPC methods by calling existing state functions. A new `playwright/` directory exports `launch()` + `WalletController` that combines service-worker seeding (setup) with page-evaluated RPC calls (mid-test control). The built extension ships alongside compiled helpers as an npm package.

**Tech Stack:** TypeScript, Playwright (chromium), tsup (playwright helper build), WXT (extension build)

---

### Task 1: Add `test-rpc.ts` — test RPC method handler

**Files:**
- Create: `lib/background/test-rpc.ts`
- Test: `test/background/test-rpc.test.ts`

This module exports two things:
1. `handleTestRpc()` — dispatches `wallet_test*` methods, returns `NOT_HANDLED` for anything else
2. `getSigningMode()` / `setSigningMode()` — in-memory signing mode accessor

- [ ] **Step 1: Create test file with first test — `wallet_testGetState`**

Create `test/background/test-rpc.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the state module before import
vi.mock('../../lib/background/state.js', () => ({
  getSiteState: vi.fn(),
  setSiteState: vi.fn(),
  getGlobalSettings: vi.fn(),
  getComposedState: vi.fn(),
  notifyAccountsChanged: vi.fn(),
  notifyChainChanged: vi.fn(),
}));

import { handleTestRpc, NOT_HANDLED, getSigningMode, setSigningMode } from '../../lib/background/test-rpc.js';
import { getComposedState } from '../../lib/background/state.js';

const ORIGIN = 'http://localhost:3000';

describe('handleTestRpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSigningMode('prompt');
  });

  it('returns NOT_HANDLED for non-test methods', async () => {
    const result = await handleTestRpc(ORIGIN, 'eth_chainId');
    expect(result).toBe(NOT_HANDLED);
  });

  it('wallet_testGetState returns composed state', async () => {
    const fakeState = { chainId: 1, selectedAddress: null, isConnected: false };
    vi.mocked(getComposedState).mockResolvedValue(fakeState as any);

    const result = await handleTestRpc(ORIGIN, 'wallet_testGetState');
    expect(result).toEqual({ result: fakeState });
    expect(getComposedState).toHaveBeenCalledWith(ORIGIN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- test/background/test-rpc.test.ts`
Expected: FAIL — `Cannot find module '../../lib/background/test-rpc.js'`

- [ ] **Step 3: Create `test-rpc.ts` with `wallet_testGetState`**

Create `lib/background/test-rpc.ts`:

```typescript
import {
  getSiteState,
  setSiteState,
  getComposedState,
  notifyAccountsChanged,
  notifyChainChanged,
} from './state.js';
import type { AddressSource } from '../shared/types.js';
import type { Address } from 'viem';

export const NOT_HANDLED = Symbol('not-handled');
type TestRpcResult = { result?: unknown; error?: { code: number; message: string } } | typeof NOT_HANDLED;

// ── Signing mode (in-memory only, resets on SW restart) ──

export type SigningMode = 'approve' | 'reject' | 'error' | 'prompt';
let signingMode: SigningMode = 'prompt';

export function getSigningMode(): SigningMode {
  return signingMode;
}

export function setSigningMode(mode: SigningMode) {
  signingMode = mode;
}

// ── Handler ──

export async function handleTestRpc(
  origin: string,
  method: string,
  params?: unknown[],
): Promise<TestRpcResult> {
  switch (method) {
    case 'wallet_testGetState': {
      const state = await getComposedState(origin);
      return { result: state };
    }

    default:
      return NOT_HANDLED;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- test/background/test-rpc.test.ts`
Expected: PASS

- [ ] **Step 5: Add tests for remaining methods**

Append to `test/background/test-rpc.test.ts`. First add these to the existing imports at the top of the file:

```typescript
import {
  setSiteState,
  notifyAccountsChanged,
  notifyChainChanged,
} from '../../lib/background/state.js';
```

Then append after the closing `});` of the first `describe` block:

describe('wallet_testConnect', () => {
  it('marks origin as connected with address', async () => {
    const result = await handleTestRpc(ORIGIN, 'wallet_testConnect', [
      { address: '0x1111111111111111111111111111111111111111' },
    ]);
    expect(result).toEqual({ result: null });
    expect(setSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: {
        address: '0x1111111111111111111111111111111111111111',
        source: { type: 'manual' },
      },
      isConnected: true,
    });
    expect(notifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, [
      '0x1111111111111111111111111111111111111111',
    ]);
  });

  it('marks origin as connected without address', async () => {
    const result = await handleTestRpc(ORIGIN, 'wallet_testConnect');
    expect(result).toEqual({ result: null });
    expect(setSiteState).toHaveBeenCalledWith(ORIGIN, { isConnected: true });
  });
});

describe('wallet_testDisconnect', () => {
  it('clears connection and notifies', async () => {
    const result = await handleTestRpc(ORIGIN, 'wallet_testDisconnect');
    expect(result).toEqual({ result: null });
    expect(setSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: null,
      isConnected: false,
    });
    expect(notifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, []);
  });
});

describe('wallet_testSetAccount', () => {
  it('sets address and emits accountsChanged', async () => {
    const addr = '0x2222222222222222222222222222222222222222';
    const result = await handleTestRpc(ORIGIN, 'wallet_testSetAccount', [
      { address: addr },
    ]);
    expect(result).toEqual({ result: null });
    expect(setSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: { address: addr, source: { type: 'manual' } },
      isConnected: true,
    });
    expect(notifyAccountsChanged).toHaveBeenCalledWith(ORIGIN, [addr]);
  });

  it('passes custom source through', async () => {
    const addr = '0x3333333333333333333333333333333333333333';
    const source = { type: 'operator', operatorId: '5', role: 'manager' };
    const result = await handleTestRpc(ORIGIN, 'wallet_testSetAccount', [
      { address: addr, source },
    ]);
    expect(result).toEqual({ result: null });
    expect(setSiteState).toHaveBeenCalledWith(ORIGIN, {
      selectedAddress: { address: addr, source },
      isConnected: true,
    });
  });
});

describe('wallet_testSetNetwork', () => {
  it('switches chain and emits chainChanged', async () => {
    const result = await handleTestRpc(ORIGIN, 'wallet_testSetNetwork', [
      { chainId: 560048 },
    ]);
    expect(result).toEqual({ result: null });
    expect(setSiteState).toHaveBeenCalledWith(ORIGIN, { chainId: 560048 });
    expect(notifyChainChanged).toHaveBeenCalledWith(ORIGIN, 560048);
  });
});

describe('wallet_testSetSigningMode', () => {
  it('sets signing mode', async () => {
    const result = await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [
      { mode: 'approve' },
    ]);
    expect(result).toEqual({ result: null });
    expect(getSigningMode()).toBe('approve');
  });

  it('rejects invalid mode', async () => {
    const result = await handleTestRpc(ORIGIN, 'wallet_testSetSigningMode', [
      { mode: 'invalid' },
    ]);
    expect(result).toEqual({
      error: { code: -32602, message: expect.stringContaining('Invalid signing mode') },
    });
  });
});

describe('wallet_testSeedOperators', () => {
  it('writes to operator cache storage', async () => {
    const operators = [{ id: '1', managerAddress: '0x1111111111111111111111111111111111111111' }];
    const result = await handleTestRpc(ORIGIN, 'wallet_testSeedOperators', [
      { operators, chainId: 1, moduleType: 'csm' },
    ]);
    expect(result).toEqual({ result: null });
    // Verify chrome.storage.local.set was called with correct key
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ operators_csm_1: expect.objectContaining({ operators }) }),
    );
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm run test -- test/background/test-rpc.test.ts`
Expected: FAIL — missing method implementations

- [ ] **Step 7: Implement all remaining methods in `test-rpc.ts`**

Update `lib/background/test-rpc.ts` — replace the `handleTestRpc` function body:

```typescript
export async function handleTestRpc(
  origin: string,
  method: string,
  params?: unknown[],
): Promise<TestRpcResult> {
  switch (method) {
    case 'wallet_testGetState': {
      const state = await getComposedState(origin);
      return { result: state };
    }

    case 'wallet_testConnect': {
      const opts = (params?.[0] ?? {}) as { address?: Address; source?: AddressSource };
      if (opts.address) {
        await setSiteState(origin, {
          selectedAddress: {
            address: opts.address,
            source: opts.source ?? { type: 'manual' },
          },
          isConnected: true,
        });
        await notifyAccountsChanged(origin, [opts.address]);
      } else {
        await setSiteState(origin, { isConnected: true });
      }
      return { result: null };
    }

    case 'wallet_testDisconnect': {
      await setSiteState(origin, { selectedAddress: null, isConnected: false });
      await notifyAccountsChanged(origin, []);
      return { result: null };
    }

    case 'wallet_testSetAccount': {
      const { address, source } = (params?.[0] ?? {}) as {
        address: Address;
        source?: AddressSource;
      };
      await setSiteState(origin, {
        selectedAddress: { address, source: source ?? { type: 'manual' } },
        isConnected: true,
      });
      await notifyAccountsChanged(origin, [address]);
      return { result: null };
    }

    case 'wallet_testSetNetwork': {
      const { chainId } = (params?.[0] ?? {}) as { chainId: number };
      await setSiteState(origin, { chainId });
      await notifyChainChanged(origin, chainId);
      return { result: null };
    }

    case 'wallet_testSetSigningMode': {
      const { mode } = (params?.[0] ?? {}) as { mode: string };
      const valid: SigningMode[] = ['approve', 'reject', 'error', 'prompt'];
      if (!valid.includes(mode as SigningMode)) {
        return { error: { code: -32602, message: `Invalid signing mode: ${mode}` } };
      }
      signingMode = mode as SigningMode;
      return { result: null };
    }

    case 'wallet_testSeedOperators': {
      const { operators, chainId, moduleType } = (params?.[0] ?? {}) as {
        operators: unknown[];
        chainId: number;
        moduleType: string;
      };
      const key = `operators_${moduleType}_${chainId}`;
      await chrome.storage.local.set({
        [key]: { operators, lastFetchedAt: Date.now() },
      });
      return { result: null };
    }

    default:
      return NOT_HANDLED;
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm run test -- test/background/test-rpc.test.ts`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add lib/background/test-rpc.ts test/background/test-rpc.test.ts
git commit -m "feat: add wallet_test* RPC methods for Playwright automation"
```

---

### Task 2: Wire test RPC into the service worker

**Files:**
- Modify: `lib/background/rpc-handler.ts:1-5,24-29` (import + routing)
- Modify: `entrypoints/background.ts:125-146` (signing mode check)

- [ ] **Step 1: Add test-rpc routing to `rpc-handler.ts`**

In `lib/background/rpc-handler.ts`, add the import at the top:

```typescript
import { handleTestRpc, NOT_HANDLED } from './test-rpc.js';
```

Then add the routing check at the start of `handleRpcRequest`, before the `switch`:

```typescript
export async function handleRpcRequest(
  method: string,
  params: unknown[] | undefined,
  origin: string,
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  // Test RPC methods — handled entirely by test-rpc module
  const testResult = await handleTestRpc(origin, method, params);
  if (testResult !== NOT_HANDLED) return testResult;

  const siteState = await getSiteState(origin);
  // ... rest unchanged
```

- [ ] **Step 2: Add signing mode check to `handleWithApproval` in `background.ts`**

In `entrypoints/background.ts`, add import:

```typescript
import { getSigningMode } from '../lib/background/test-rpc.js';
```

Replace the signing-methods block inside `handleWithApproval` (lines 135-144):

```typescript
    if (SIGNING_METHODS.has(method)) {
      const mode = getSigningMode();
      if (mode === 'reject') {
        return { error: { code: 4001, message: 'CSM Dev Wallet: User rejected the request' } };
      }
      if (mode === 'error') {
        return { error: { code: -32603, message: 'CSM Dev Wallet: Simulated RPC error' } };
      }
      if (mode !== 'approve') {
        // mode === 'prompt' — use existing approval popup flow
        const siteState = await getSiteState(origin);
        const globalSettings = await getGlobalSettings();
        if (globalSettings.requireApproval && siteState.chainId === ANVIL_CHAIN_ID && siteState.selectedAddress) {
          const approved = await requestApproval(method, siteState.selectedAddress.address, pendingApprovals);
          if (!approved) {
            return { error: { code: 4001, message: 'CSM Dev Wallet: User rejected the request' } };
          }
        }
      }
      // mode === 'approve' falls through — no popup, direct execution
    }
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `npm run test`
Expected: All existing tests pass

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add lib/background/rpc-handler.ts entrypoints/background.ts
git commit -m "feat: wire test RPC methods into service worker"
```

---

### Task 3: Create the Playwright helper package

**Files:**
- Create: `playwright/index.ts`
- Create: `playwright/wallet-controller.ts`
- Create: `playwright/types.ts`
- Create: `playwright/tsconfig.json`

- [ ] **Step 1: Create `playwright/types.ts`**

```typescript
import type { Address } from 'viem';
import type { BrowserContext, Page, Worker } from 'playwright';

export type SigningMode = 'approve' | 'reject' | 'error' | 'prompt';

export type AddressSource =
  | { type: 'operator'; operatorId: string; role: string }
  | { type: 'anvil'; index: number }
  | { type: 'manual' };

export type SetupOptions = {
  origin: string;
  network?: number;
  account?: Address;
  accountSource?: AddressSource;
  signingMode?: SigningMode;
  operators?: unknown[];
  operatorsChainId?: number;
  operatorsModuleType?: string;
  moduleAvailability?: { csm: boolean; cm: boolean };
  moduleAvailabilityChainId?: number;
};

export type LaunchOptions = {
  extensionPath?: string;
  headless?: boolean;
};

export type LaunchResult = {
  context: BrowserContext;
  wallet: WalletController;
  extensionId: string;
};

export interface WalletController {
  /** Pre-seed state before page navigation. Talks to service worker. */
  setup(options: SetupOptions): Promise<void>;

  /** Switch selected address on the page. Emits accountsChanged. */
  switchAccount(page: Page, address: Address, source?: AddressSource): Promise<void>;

  /** Switch network on the page. Emits chainChanged. */
  switchNetwork(page: Page, chainId: number): Promise<void>;

  /** Connect the wallet on the page. */
  connect(page: Page, address?: Address, source?: AddressSource): Promise<void>;

  /** Disconnect the wallet on the page. Emits accountsChanged([]). */
  disconnect(page: Page): Promise<void>;

  /** Set signing behavior for subsequent sign requests. */
  setSigningMode(page: Page, mode: SigningMode): Promise<void>;

  /** Get current wallet state from the page's origin. */
  getState(page: Page): Promise<Record<string, unknown>>;

  /** Seed operators into the cache. */
  seedOperators(page: Page, operators: unknown[], chainId: number, moduleType?: string): Promise<void>;

  /** Access the underlying service worker. */
  readonly sw: Worker;

  /** The extension ID. */
  readonly extensionId: string;
}
```

- [ ] **Step 2: Create `playwright/wallet-controller.ts`**

```typescript
import type { Page, Worker } from 'playwright';
import type { Address } from 'viem';
import type { WalletController, SetupOptions, SigningMode, AddressSource } from './types.js';

export function createWalletController(sw: Worker, extensionId: string): WalletController {
  async function resetCaches() {
    await sw.evaluate(() => {
      (self as any).__resetStateCaches?.();
    });
  }

  async function setup(options: SetupOptions) {
    await resetCaches();

    const { origin } = options;

    // Seed site state
    const siteState: Record<string, unknown> = {};
    if (options.network !== undefined) siteState.chainId = options.network;
    if (options.account) {
      siteState.selectedAddress = {
        address: options.account,
        source: options.accountSource ?? { type: 'manual' },
      };
      siteState.isConnected = true;
    }

    if (Object.keys(siteState).length > 0) {
      await sw.evaluate(
        async ([o, patch]) => {
          const defaults = { chainId: 1, moduleType: 'csm', selectedAddress: null, isConnected: false };
          const data = await chrome.storage.local.get('site_states');
          const sites = data.site_states ?? {};
          const current = sites[o] ?? defaults;
          await chrome.storage.local.set({ site_states: { ...sites, [o]: { ...current, ...patch } } });
        },
        [origin, siteState] as const,
      );
      await resetCaches();
    }

    // Seed global settings
    if (options.signingMode && options.signingMode !== 'prompt') {
      // signingMode is in-memory in the SW — set it via evaluate
      await sw.evaluate((mode) => {
        (self as any).__testSigningMode = mode;
      }, options.signingMode);
    }

    // Seed operators
    if (options.operators) {
      const chainId = options.operatorsChainId ?? options.network ?? 1;
      const moduleType = options.operatorsModuleType ?? 'csm';
      const key = `operators_${moduleType}_${chainId}`;
      await sw.evaluate(
        async ([k, ops]) => {
          await chrome.storage.local.set({ [k]: { operators: ops, lastFetchedAt: Date.now() } });
        },
        [key, options.operators] as const,
      );
    }

    // Seed module availability
    if (options.moduleAvailability) {
      const chainId = options.moduleAvailabilityChainId ?? options.network ?? 1;
      const key = `module_availability_${chainId}`;
      await sw.evaluate(
        async ([k, mods]) => {
          await chrome.storage.local.set({ [k]: { ...mods, checkedAt: Date.now() } });
        },
        [key, options.moduleAvailability] as const,
      );
    }
  }

  function rpc(page: Page, method: string, params?: unknown[]) {
    return page.evaluate(
      ([m, p]) => (window as any).ethereum.request({ method: m, params: p }),
      [method, params ?? []] as const,
    );
  }

  return {
    setup,

    async switchAccount(page: Page, address: Address, source?: AddressSource) {
      await rpc(page, 'wallet_testSetAccount', [{ address, source }]);
    },

    async switchNetwork(page: Page, chainId: number) {
      await rpc(page, 'wallet_testSetNetwork', [{ chainId }]);
    },

    async connect(page: Page, address?: Address, source?: AddressSource) {
      await rpc(page, 'wallet_testConnect', [{ address, source }]);
    },

    async disconnect(page: Page) {
      await rpc(page, 'wallet_testDisconnect');
    },

    async setSigningMode(page: Page, mode: SigningMode) {
      await rpc(page, 'wallet_testSetSigningMode', [{ mode }]);
    },

    async getState(page: Page) {
      return rpc(page, 'wallet_testGetState') as Promise<Record<string, unknown>>;
    },

    async seedOperators(page: Page, operators: unknown[], chainId: number, moduleType = 'csm') {
      await rpc(page, 'wallet_testSeedOperators', [{ operators, chainId, moduleType }]);
    },

    get sw() { return sw; },
    get extensionId() { return extensionId; },
  };
}
```

- [ ] **Step 3: Create `playwright/index.ts`**

```typescript
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletController } from './wallet-controller.js';
import type { LaunchOptions, LaunchResult } from './types.js';

export type { WalletController, LaunchOptions, LaunchResult, SetupOptions, SigningMode, AddressSource } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_EXTENSION_PATH = resolve(__dirname, '../extension');

export async function launch(options?: LaunchOptions): Promise<LaunchResult> {
  const extensionPath = options?.extensionPath ?? BUNDLED_EXTENSION_PATH;
  const headless = options?.headless ?? true;

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
      ...(headless ? ['--headless=new'] : []),
    ],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];

  const wallet = createWalletController(sw, extensionId);

  return { context, wallet, extensionId };
}
```

- [ ] **Step 4: Create `playwright/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "outDir": "../dist/playwright",
    "rootDir": ".",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 5: Commit**

```bash
git add playwright/
git commit -m "feat: add Playwright helper package (launch + WalletController)"
```

---

### Task 4: Wire signing mode through the service worker evaluate path

**Files:**
- Modify: `lib/background/test-rpc.ts` (add `__testSigningMode` bridge)
- Modify: `entrypoints/background.ts` (read from self)

The `setup()` method in the Playwright helper sets signing mode via `sw.evaluate()` on `self.__testSigningMode`. The service worker needs to read this when `getSigningMode()` is called.

- [ ] **Step 1: Update `test-rpc.ts` to check `self.__testSigningMode`**

In `lib/background/test-rpc.ts`, update `getSigningMode`:

```typescript
export function getSigningMode(): SigningMode {
  // Allow setting from sw.evaluate() during Playwright setup (before any page exists)
  if (typeof self !== 'undefined' && (self as any).__testSigningMode) {
    const external = (self as any).__testSigningMode as string;
    const valid: SigningMode[] = ['approve', 'reject', 'error', 'prompt'];
    if (valid.includes(external as SigningMode)) return external as SigningMode;
  }
  return signingMode;
}

export function setSigningMode(mode: SigningMode) {
  signingMode = mode;
  // Also clear the external override so RPC-set values take precedence
  if (typeof self !== 'undefined') {
    (self as any).__testSigningMode = undefined;
  }
}
```

- [ ] **Step 2: Run existing tests**

Run: `npm run test`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add lib/background/test-rpc.ts
git commit -m "feat: bridge signing mode from sw.evaluate for Playwright setup"
```

---

### Task 5: Build pipeline and package.json exports

**Files:**
- Modify: `package.json` (add exports, scripts, tsup dep)
- Modify: `.gitignore` (add dist/)

- [ ] **Step 1: Install tsup**

Run: `npm install -D tsup`

- [ ] **Step 2: Update `package.json`**

Add exports, files, and build scripts. In `package.json`:

Remove `"private": true` and add:

```json
{
  "exports": {
    "./playwright": {
      "types": "./dist/playwright/index.d.ts",
      "import": "./dist/playwright/index.mjs"
    }
  },
  "files": [
    "dist/"
  ],
  "scripts": {
    "build:playwright": "tsup playwright/index.ts --format esm --dts --outDir dist/playwright --external playwright --external viem",
    "build:package": "npm run build && npm run build:playwright && cp -r .output/chrome-mv3 dist/extension"
  }
}
```

Keep all existing scripts. The new `build:package` chains: extension build → playwright helpers build → copy extension to dist.

- [ ] **Step 3: Create `dist/` gitignore**

Add to `.gitignore`:

```
dist/
```

- [ ] **Step 4: Test the build pipeline**

Run: `npm run build:package`
Expected: `dist/` contains `extension/` (manifest.json etc.) and `playwright/` (index.mjs, index.d.ts, etc.)

- [ ] **Step 5: Verify the export resolves**

Run: `node -e "import('./dist/playwright/index.mjs').then(m => console.log(Object.keys(m)))"`
Expected: Prints `[ 'launch' ]` (or similar list of exports)

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore playwright/tsconfig.json
git commit -m "feat: add build pipeline and npm exports for playwright package"
```

---

### Task 6: E2E smoke test for the Playwright API

**Files:**
- Create: `test/e2e/playwright-api.e2e.ts`

This test uses the new `launch()` + `WalletController` API to verify the full flow works end-to-end: setup → connect → switch → disconnect, all without touching the popup.

- [ ] **Step 1: Create the e2e test**

Create `test/e2e/playwright-api.e2e.ts`:

```typescript
/**
 * E2E: Playwright automation API smoke test.
 *
 * Tests the new wallet_test* RPC methods and WalletController API.
 *
 * Run: npx tsx test/e2e/playwright-api.e2e.ts
 * Requires: npm run build first
 */
import { createRunner, startTestDapp, openTestDapp, makeTestOperators } from './helpers.js';
import { launch } from '../../playwright/index.js';

const { test, summary } = createRunner();

async function main() {
  const dapp = await startTestDapp();
  const dappOrigin = new URL(dapp.url).origin;
  console.log(`Test dapp at ${dapp.url}\n`);

  const operators = makeTestOperators(3);
  const address = operators[0].managerAddress;

  // Use the new launch() API with local build path
  const { context, wallet } = await launch({
    extensionPath: new URL('../../.output/chrome-mv3', import.meta.url).pathname,
  });

  try {
    // ── Test 1: Setup auto-connects, no popup ──

    await test('Setup pre-seeds state — eth_requestAccounts returns address immediately', async () => {
      await wallet.setup({
        origin: dappOrigin,
        network: 1,
        account: address,
      });

      const page = await openTestDapp(context, dapp.url);
      await page.click('#connect');

      await page.waitForFunction(
        (addr) => document.getElementById('address')?.textContent?.toLowerCase() === addr.toLowerCase(),
        address,
        { timeout: 5000 },
      );

      const shown = (await page.textContent('#address'))!.toLowerCase();
      if (shown !== address.toLowerCase()) throw new Error(`Expected ${address}, got ${shown}`);
      await page.close();
    });

    // ── Test 2: switchAccount via RPC ──

    await test('wallet.switchAccount emits accountsChanged', async () => {
      await wallet.setup({ origin: dappOrigin, network: 1, account: address });
      const page = await openTestDapp(context, dapp.url);
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent !== 'Not connected',
        null,
        { timeout: 5000 },
      );

      const newAddr = operators[1].managerAddress;
      await wallet.switchAccount(page, newAddr);

      await page.waitForFunction(
        (addr) => document.getElementById('address')?.textContent?.toLowerCase() === addr.toLowerCase(),
        newAddr,
        { timeout: 5000 },
      );

      const events = await page.textContent('#events');
      if (!events?.includes('accountsChanged')) throw new Error('Missing accountsChanged event');
      await page.close();
    });

    // ── Test 3: switchNetwork via RPC ──

    await test('wallet.switchNetwork emits chainChanged', async () => {
      await wallet.setup({ origin: dappOrigin, network: 1, account: address });
      const page = await openTestDapp(context, dapp.url);
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('chain-id')?.textContent === '0x1',
        null,
        { timeout: 5000 },
      );

      await wallet.switchNetwork(page, 560048);

      await page.waitForFunction(
        () => document.getElementById('chain-id')?.textContent === '0x88bb0',
        null,
        { timeout: 5000 },
      );

      const events = await page.textContent('#events');
      if (!events?.includes('chainChanged')) throw new Error('Missing chainChanged event');
      await page.close();
    });

    // ── Test 4: disconnect via RPC ──

    await test('wallet.disconnect clears address', async () => {
      await wallet.setup({ origin: dappOrigin, network: 1, account: address });
      const page = await openTestDapp(context, dapp.url);
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent !== 'Not connected',
        null,
        { timeout: 5000 },
      );

      await wallet.disconnect(page);

      await page.waitForFunction(
        () => document.getElementById('address')?.textContent === 'Not connected',
        null,
        { timeout: 5000 },
      );
      await page.close();
    });

    // ── Test 5: getState ──

    await test('wallet.getState returns current state', async () => {
      await wallet.setup({ origin: dappOrigin, network: 1, account: address });
      const page = await openTestDapp(context, dapp.url);

      const state = await wallet.getState(page);
      if (state.chainId !== 1) throw new Error(`Expected chainId 1, got ${state.chainId}`);
      await page.close();
    });

    // ── Test 6: setSigningMode reject ──

    await test('wallet.setSigningMode("reject") causes 4001 on sendTransaction', async () => {
      await wallet.setup({
        origin: dappOrigin,
        network: 31337, // Anvil
        account: address,
      });
      const page = await openTestDapp(context, dapp.url);
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent !== 'Not connected',
        null,
        { timeout: 5000 },
      );

      await wallet.setSigningMode(page, 'reject');
      await page.click('#send-tx');

      await page.waitForFunction(
        () => (document.getElementById('status')?.textContent ?? '').startsWith('error:'),
        null,
        { timeout: 5000 },
      );

      const status = await page.textContent('#status');
      if (!status?.includes('4001')) throw new Error(`Expected 4001, got: ${status}`);
      await page.close();
    });

    const { passed, failed } = summary();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } finally {
    await context.close();
    await dapp.close();
  }

  process.exit(summary().failed > 0 ? 1 : 0);
}

main();
```

- [ ] **Step 2: Build and run the e2e test**

Run: `npm run build && npx tsx test/e2e/playwright-api.e2e.ts`
Expected: All 6 tests pass

- [ ] **Step 3: Commit**

```bash
git add test/e2e/playwright-api.e2e.ts
git commit -m "test: add e2e smoke test for Playwright automation API"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run all unit tests**

Run: `npm run test`
Expected: All pass

- [ ] **Step 2: Run all e2e tests**

Run: `npm run test:e2e`
Expected: All existing + new e2e tests pass

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 5: Run full package build**

Run: `npm run build:package`
Expected: `dist/` contains `extension/` and `playwright/` with `.mjs` + `.d.ts` files
