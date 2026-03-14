/**
 * E2E: Dapp integration — provider injection, connect/disconnect, events.
 *
 * Tests the full 3-layer stack: inpage provider → content script → service worker.
 *
 * Run: npx tsx test/e2e/dapp-integration.e2e.ts
 * Requires: npm run build first
 */
import {
  launchExtension,
  seedOperators,
  seedModuleAvailability,
  makeTestOperators,
  createRunner,
  resetStateCaches,
  startTestDapp,
  openTestDapp,
} from './helpers.js';
import type { Worker } from 'playwright';

const { test, summary } = createRunner();

/** Seed dapp-origin site state directly in storage. */
async function seedDappState(
  sw: Worker,
  origin: string,
  state: Record<string, unknown>,
) {
  await sw.evaluate(async ([o, s]) => {
    const data = await chrome.storage.local.get('site_states');
    const sites = data.site_states ?? {};
    sites[o] = { chainId: 1, moduleType: 'csm', selectedAddress: null, isConnected: false, ...s };
    await chrome.storage.local.set({ site_states: sites });
  }, [origin, state] as const);
  await resetStateCaches(sw);
}

async function main() {
  const dapp = await startTestDapp();
  console.log(`Test dapp at ${dapp.url}\n`);
  const dappOrigin = new URL(dapp.url).origin;

  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  const operators = makeTestOperators(3);
  const expectedAddress = operators[0].managerAddress.toLowerCase();
  const selectedAddress = {
    address: operators[0].managerAddress,
    source: { type: 'operator', operatorId: '1', role: 'manager' },
  };

  async function seed() {
    await resetStateCaches(sw);
    await seedOperators(sw, operators, 1, 'csm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: false });
  }

  try {
    await seed();

    // ── Test 1: Provider injected ──

    await test('Provider injected with isCSMDevWallet flag', async () => {
      const page = await openTestDapp(context, dapp.url);
      const flag = await page.evaluate(() => (window as any).ethereum?.isCSMDevWallet);
      if (flag !== true) throw new Error(`Expected isCSMDevWallet=true, got ${flag}`);
      await page.close();
    });

    // ── Test 2: Connect flow via connection prompt ──

    await test('Connect flow — popup opens, select address, dapp shows address', async () => {
      await seed();
      const page = await openTestDapp(context, dapp.url);

      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 15000 }),
        page.click('#connect'),
      ]);

      await popup.waitForSelector('.address-row', { timeout: 10000 });
      await popup.locator('.address-row').first().click();

      await page.waitForFunction(
        (addr) => document.getElementById('address')?.textContent?.toLowerCase() === addr,
        expectedAddress,
        { timeout: 10000 },
      );

      const shown = (await page.textContent('#address'))!.toLowerCase();
      if (shown !== expectedAddress) throw new Error(`Expected ${expectedAddress}, got ${shown}`);
      await page.close();
    });

    // ── Test 3: Chain ID displayed ──

    await test('Chain ID displayed as 0x1 after connect', async () => {
      await seed();
      await seedDappState(sw, dappOrigin, { selectedAddress, isConnected: true });

      const page = await openTestDapp(context, dapp.url);

      await page.waitForFunction(
        () => document.getElementById('chain-id')?.textContent === '0x1',
        null,
        { timeout: 10000 },
      );

      const chainId = await page.textContent('#chain-id');
      if (chainId !== '0x1') throw new Error(`Expected 0x1, got ${chainId}`);
      await page.close();
    });

    // ── Test 4: Disconnect from popup ──

    await test('Disconnect from popup — dapp resets, accountsChanged fires', async () => {
      await seed();
      await seedDappState(sw, dappOrigin, { selectedAddress, isConnected: true });

      const page = await openTestDapp(context, dapp.url);

      // Connect to get address displayed
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent !== 'Not connected',
        null,
        { timeout: 10000 },
      );

      // Open popup for this dapp's origin and disconnect
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html?origin=${encodeURIComponent(dappOrigin)}`);
      await popup.waitForSelector('.app');
      await popup.waitForSelector('.btn-disconnect', { timeout: 5000 });
      await popup.click('.btn-disconnect');
      await popup.close();

      // Dapp should receive accountsChanged and reset
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent === 'Not connected',
        null,
        { timeout: 10000 },
      );

      const eventsText = await page.textContent('#events');
      if (!eventsText?.includes('accountsChanged')) {
        throw new Error(`Expected accountsChanged event, got: ${eventsText}`);
      }
      await page.close();
    });

    // ── Test 5: Reconnect after disconnect ──

    await test('Reconnect after disconnect — popup opens, select address again', async () => {
      await seed();
      // Ensure disconnected state for dapp origin
      await seedDappState(sw, dappOrigin, { selectedAddress: null, isConnected: false });

      const page = await openTestDapp(context, dapp.url);

      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 15000 }),
        page.click('#connect'),
      ]);

      await popup.waitForSelector('.address-row', { timeout: 10000 });
      await popup.locator('.address-row').first().click();

      await page.waitForFunction(
        (addr) => document.getElementById('address')?.textContent?.toLowerCase() === addr,
        expectedAddress,
        { timeout: 10000 },
      );

      const shown = (await page.textContent('#address'))!.toLowerCase();
      if (shown !== expectedAddress) throw new Error(`Expected ${expectedAddress}, got ${shown}`);
      await page.close();
    });

    // ── Test 6: chainChanged event ──

    await test('chainChanged event fires on network switch from popup', async () => {
      await seed();
      await seedDappState(sw, dappOrigin, { selectedAddress, isConnected: true });
      await seedOperators(sw, makeTestOperators(2), 560048, 'csm');
      await seedModuleAvailability(sw, 560048, { csm: true, cm: false });

      const page = await openTestDapp(context, dapp.url);

      // Connect to get address displayed
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent !== 'Not connected',
        null,
        { timeout: 10000 },
      );

      // Open popup and switch network to Hoodi
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html?origin=${encodeURIComponent(dappOrigin)}`);
      await popup.waitForSelector('.app');
      await popup.selectOption('.network-select', '560048');
      await popup.waitForTimeout(1000);
      await popup.close();

      // Dapp should receive chainChanged event
      await page.waitForFunction(
        () => (document.getElementById('events')?.textContent ?? '').includes('chainChanged'),
        null,
        { timeout: 10000 },
      );

      const chainId = await page.textContent('#chain-id');
      // Hoodi = 560048 = 0x88bb0
      if (chainId !== '0x88bb0') throw new Error(`Expected 0x88bb0 (Hoodi), got ${chainId}`);
      await page.close();
    });

    // ── Test 7: Sign TX rejected on watch-only (mainnet) ──

    await test('Sign TX rejected with code 4200 on mainnet (watch-only)', async () => {
      await seed();
      await seedDappState(sw, dappOrigin, { selectedAddress, isConnected: true });

      const page = await openTestDapp(context, dapp.url);

      // Connect to get address displayed
      await page.click('#connect');
      await page.waitForFunction(
        () => document.getElementById('address')?.textContent !== 'Not connected',
        null,
        { timeout: 10000 },
      );

      // Try sending a transaction
      await page.click('#send-tx');
      await page.waitForFunction(
        () => (document.getElementById('status')?.textContent ?? '').startsWith('error:'),
        null,
        { timeout: 10000 },
      );

      const status = await page.textContent('#status');
      if (!status?.includes('4200')) throw new Error(`Expected error code 4200, got: ${status}`);
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
