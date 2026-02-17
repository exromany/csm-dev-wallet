/**
 * Shared e2e helpers — launch extension, seed storage, test runner.
 */
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import { resolve } from 'node:path';
import type { CachedOperator, WalletState, ModuleType, OperatorCacheEntry } from '../../lib/shared/types.js';

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

export type TabName = 'Operators' | 'Manual' | 'Settings';

export async function goToTab(page: Page, tab: TabName) {
  await page.click(`button.tab:has-text("${tab}")`);
  // Wait for tab content to settle
  if (tab === 'Settings') await page.waitForSelector('.settings-group');
  if (tab === 'Manual') await page.waitForSelector('.manual-input-row');
  if (tab === 'Operators') await page.waitForSelector('.search-bar');
}

// ── Storage seeding via service worker ──

export async function seedState(sw: Worker, state: Partial<WalletState>) {
  await sw.evaluate(async (patch) => {
    const defaults = {
      chainId: 1,
      moduleType: 'csm',
      selectedAddress: null,
      isConnected: false,
      customRpcUrls: {},
      favorites: [],
      manualAddresses: [],
    };
    const data = await chrome.storage.local.get('wallet_state');
    const current = data.wallet_state ?? defaults;
    await chrome.storage.local.set({ wallet_state: { ...current, ...patch } });
  }, state);
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
      await chrome.storage.local.set({ [k]: v });
    },
    [key, { ...modules, checkedAt: Date.now() }] as const,
  );
}

export async function clearStorage(sw: Worker) {
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
