/**
 * Shared e2e helpers — launch extension, seed storage, test runner.
 */
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CachedOperator, WalletState, SiteState, GlobalSettings, ModuleType, OperatorCacheEntry } from '../../lib/shared/types.js';

const EXTENSION_PATH = resolve(import.meta.dirname, '../../.output/chrome-mv3');
const HEADED = !!process.env.HEADED;

// ── Launch & navigate ──

export async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
  sw: Worker;
}> {
  const context = await chromium.launchPersistentContext('', {
    headless: false, // We handle headless ourselves — Playwright's headless uses old mode
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
      ...(!HEADED ? ['--headless=new'] : []),
    ],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];

  return { context, extensionId, sw };
}

export async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('.app');
  return page;
}

export type TabName = 'Operators' | 'Shared' | 'Manual' | 'Settings';

export async function goToTab(page: Page, tab: TabName) {
  // Settings moved out of the tab bar into a header icon button.
  if (tab === 'Settings') {
    await page.click('.icon-btn[title="Settings"]');
    await page.waitForSelector('.settings-group');
    return;
  }
  await page.click(`button.tab:has-text("${tab}")`);
  if (tab === 'Manual') await page.waitForSelector('.manual-form');
  if (tab === 'Operators') await page.waitForSelector('.search-bar input');
  if (tab === 'Shared') await page.waitForSelector('.filter-bar');
}

// ── UI helpers ──────────────────────────────────────────
//
// The redesigned popup replaces the native <select> network picker with a
// chip+panel combo and renames a few elements; these helpers hide the new
// markup so tests stay declarative.

/** Fill the operator search box (which is now the inner <input> of `.search-bar`). */
export async function fillSearch(page: Page, value: string) {
  await page.fill('.search-bar input', value);
}

/** Open the network/module panel, switch to `chainId`, panel stays open. */
export async function selectNetwork(page: Page, chainId: number) {
  // Open the panel if it isn't already (`.netmod-panel` only exists when open).
  if (!(await page.locator('.netmod-panel').isVisible().catch(() => false))) {
    await page.click('.netmod-chip');
    await page.waitForSelector('.netmod-panel');
  }
  await page.click(`.netmod-option[data-chain-id="${chainId}"]`);
}

/** Click the manual-tab add button. */
export async function clickAdd(page: Page) {
  await page.click('.btn-add-icon');
}

/** Locator for the connected-address indicator (the pill below the header). */
export function connectedPill(page: Page) {
  return page.locator('.connected-pill');
}

/** Click an operator address row. The first `.address-chip` is the canonical pick. */
export async function clickFirstAddress(page: Page) {
  await page.waitForSelector('.address-chip', { timeout: 10000 });
  await page.locator('.address-chip').first().click();
}

/** Click a manual / anvil row by address. */
export async function clickManualRow(page: Page) {
  await page.click('.manual-entry');
}

// ── Storage seeding via service worker ──

export async function resetStateCaches(sw: Worker) {
  await sw.evaluate(() => {
    (self as any).__resetStateCaches?.();
  });
}

const SITE_KEYS: (keyof SiteState)[] = ['chainId', 'moduleType', 'selectedAddress', 'isConnected'];

export async function seedSiteState(sw: Worker, extensionId: string, state: Partial<SiteState>) {
  const origin = `chrome-extension://${extensionId}`;
  await resetStateCaches(sw);
  await sw.evaluate(async ([o, patch]) => {
    const defaults = { chainId: 1, moduleType: 'csm', selectedAddress: null, isConnected: false };
    const data = await chrome.storage.local.get('site_states');
    const sites = (data.site_states ?? {}) as Record<string, unknown>;
    const current = sites[o] ?? defaults;
    await chrome.storage.local.set({ site_states: { ...sites, [o]: { ...current, ...patch } } });
  }, [origin, state] as const);
}

export async function seedGlobalSettings(sw: Worker, settings: Partial<GlobalSettings>) {
  await resetStateCaches(sw);
  await sw.evaluate(async (patch) => {
    const defaults = { customRpcUrls: {}, favorites: [], manualAddresses: [], addressLabels: {}, operatorLabels: {}, requireApproval: false };
    const data = await chrome.storage.local.get('global_settings');
    const current = data.global_settings ?? defaults;
    await chrome.storage.local.set({ global_settings: { ...current, ...patch } });
  }, settings);
}

/** Convenience wrapper — splits WalletState into site/global parts and seeds both. */
export async function seedState(sw: Worker, extensionId: string, state: Partial<WalletState>) {
  const sitePatch: Record<string, unknown> = {};
  const globalPatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(state)) {
    if (SITE_KEYS.includes(k as keyof SiteState)) sitePatch[k] = v;
    else globalPatch[k] = v;
  }
  await Promise.all([
    Object.keys(sitePatch).length > 0 ? seedSiteState(sw, extensionId, sitePatch as Partial<SiteState>) : Promise.resolve(),
    Object.keys(globalPatch).length > 0 ? seedGlobalSettings(sw, globalPatch as Partial<GlobalSettings>) : Promise.resolve(),
  ]);
}

export async function seedOperators(
  sw: Worker,
  operators: CachedOperator[],
  chainId: number,
  moduleType: ModuleType = 'csm',
) {
  const key = `operators_${moduleType}_${chainId}`;
  const entry: OperatorCacheEntry = { operators, lastFetchedAt: Date.now() };
  await sw.evaluate(
    async ([k, v]) => {
      await chrome.storage.local.set({ [k]: v });
    },
    [key, entry] as const,
  );
}

export async function seedModuleAvailability(
  sw: Worker,
  chainId: number,
  modules: { csm: boolean; cm: boolean },
) {
  const key = `module_availability_${chainId}`;
  await sw.evaluate(
    async ([k, v]) => {
      // The worker memoises availability for 5min — storage alone won't be re-read.
      (self as any).__resetAvailabilityCache?.();
      await chrome.storage.local.set({ [k]: v });
    },
    [key, { ...modules, checkedAt: Date.now() }] as const,
  );
}

export async function clearStorage(sw: Worker) {
  await resetStateCaches(sw);
  await sw.evaluate(async () => {
    await chrome.storage.local.clear();
  });
}

// ── Test fixtures ──

const ADDRESSES = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
  '0x4444444444444444444444444444444444444444',
  '0x5555555555555555555555555555555555555555',
  '0x6666666666666666666666666666666666666666',
  '0x7777777777777777777777777777777777777777',
  '0x8888888888888888888888888888888888888888',
  '0x9999999999999999999999999999999999999999',
  '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
] as const;

const TYPES = ['DEF', 'LEA', 'ICS', 'DEF', 'LEA'] as const;

export function makeTestOperators(count: number): CachedOperator[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    managerAddress: ADDRESSES[i * 2] ?? ADDRESSES[0],
    rewardsAddress: ADDRESSES[i * 2 + 1] ?? ADDRESSES[1],
    extendedManagerPermissions: true,
    ownerAddress: ADDRESSES[i * 2] ?? ADDRESSES[0],
    curveId: '0',
    operatorType: TYPES[i % TYPES.length],
  }));
}

// ── Test dapp server ──

export async function startTestDapp(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  const html = readFileSync(resolve(import.meta.dirname, 'test-dapp.html'), 'utf-8');
  const server = await new Promise<Server>((res) => {
    const s = createServer((_, resp) => {
      resp.writeHead(200, { 'Content-Type': 'text/html' });
      resp.end(html);
    });
    s.listen(port, '127.0.0.1', () => res(s));
  });
  const addr = server.address();
  const assignedPort = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${assignedPort}`,
    close: () => new Promise((res) => server.close(() => res())),
  };
}

export async function openTestDapp(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 10000 });
  return page;
}

// ── Test runner ──

type TestResult = { name: string; passed: boolean; error?: string };

export function createRunner() {
  const results: TestResult[] = [];

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log(`  PASS: ${name}`);
    } catch (err) {
      results.push({ name, passed: false, error: String(err) });
      console.error(`  FAIL: ${name}`);
      console.error(`    ${err}`);
    }
  }

  function summary(): { passed: number; failed: number } {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    return { passed, failed };
  }

  return { test, summary, results };
}
