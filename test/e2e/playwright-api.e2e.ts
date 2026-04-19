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

  const { context, wallet } = await launch({
    extensionPath: new URL('../../.output/chrome-mv3', import.meta.url).pathname,
  });

  try {
    // Test 1: Setup auto-connects, no popup
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

    // Test 2: switchAccount via RPC
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

    // Test 3: switchNetwork via RPC
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

    // Test 4: disconnect via RPC
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

    // Test 5: getState
    await test('wallet.getState returns current state', async () => {
      await wallet.setup({ origin: dappOrigin, network: 1, account: address });
      const page = await openTestDapp(context, dapp.url);

      const state = await wallet.getState(page);
      if (state.chainId !== 1) throw new Error(`Expected chainId 1, got ${state.chainId}`);
      await page.close();
    });

    // Test 6: setSigningMode reject
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
