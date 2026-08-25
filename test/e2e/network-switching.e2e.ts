/**
 * E2E: Network switching — Mainnet ↔ Hoodi operator sets.
 *
 * Run: npx tsx test/e2e/network-switching.e2e.ts
 * Requires: npm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedModuleAvailability,
  makeTestOperators,
  createRunner,
  selectNetwork,
  fillSearch,
} from './helpers.js';

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  const mainnetOps = makeTestOperators(5);
  const hoodiOps = makeTestOperators(3).map((op, i) => ({
    ...op,
    id: String(100 + i + 1), // 101, 102, 103
  }));

  // Seed both networks' operators (reads from storage — no cache issue)
  await seedOperators(sw, mainnetOps, 1, 'csm');
  await seedOperators(sw, hoodiOps, 560048, 'csm');
  // CSM 0x02 is Hoodi-only, mirroring the SDK's MODULE_CONFIG
  await seedModuleAvailability(sw, 1, { csm: true, cm: false, csm02: false });
  await seedModuleAvailability(sw, 560048, { csm: true, cm: false, csm02: true });

  try {
    // ── Test 1: Switch to Hoodi shows 3 operators ──

    await test('Switch to Hoodi — shows 3 operators', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      let rows = await page.locator('.operator-row').count();
      if (rows !== 5) throw new Error(`Mainnet: expected 5, got ${rows}`);

      await selectNetwork(page, 560048);
      await page.waitForTimeout(500);

      rows = await page.locator('.operator-row').count();
      if (rows !== 3) throw new Error(`Hoodi: expected 3, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      if (!ids.includes('#101')) throw new Error(`Expected #101 in ${ids}`);
      await page.close();
    });

    // ── Test 2: Switch back to Mainnet shows 5 operators ──

    await test('Switch back to Mainnet — shows 5 operators', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Ensure we're on Mainnet first (previous test may have left on Hoodi)
      await selectNetwork(page, 560048);
      await page.waitForTimeout(500);

      await selectNetwork(page, 1);
      await page.waitForTimeout(500);

      const rows = await page.locator('.operator-row').count();
      if (rows !== 5) throw new Error(`Mainnet: expected 5, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      if (!ids.includes('#1')) throw new Error(`Expected #1 in ${ids}`);
      await page.close();
    });

    // ── Test 3: Network switch resets search ──

    await test('Network switch loads different operators', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Mainnet first
      await selectNetwork(page, 1);
      await page.waitForTimeout(500);

      // Search that matches Mainnet operator
      await fillSearch(page, '#1');
      await page.waitForTimeout(300);
      let rows = await page.locator('.operator-row').count();
      if (rows !== 1) throw new Error(`Search #1 on Mainnet: expected 1, got ${rows}`);

      // Switch to Hoodi — search persists but matches against new operators
      await selectNetwork(page, 560048);
      await page.waitForTimeout(500);

      // Clear search to see all Hoodi operators
      await fillSearch(page, '');
      await page.waitForTimeout(300);

      rows = await page.locator('.operator-row').count();
      if (rows !== 3) throw new Error(`Hoodi after clear: expected 3, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      if (!ids.includes('#101')) throw new Error(`Expected Hoodi ops, got ${ids}`);
      await page.close();
    });

    // ── Test: CSM 0x02 chip ──
    // Only the Mainnet (disabled) half is asserted: it follows from the SDK's
    // MODULE_CONFIG having no mainnet CSM_02 entry, so it needs no RPC. Whether
    // Hoodi reports it available depends on live on-chain discovery state, which
    // would make the assertion flaky — that path is covered by unit tests.

    await test('CSM 0x02 appears in the picker, disabled on Mainnet', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Earlier tests leave the popup persisted on Hoodi — pin the network.
      // selectNetwork leaves the panel open, so the module chips stay visible.
      await selectNetwork(page, 1);
      await page.waitForTimeout(500);

      const chip = page.locator('.netmod-option[data-module-type="csm02"]');
      if ((await chip.count()) !== 1) throw new Error('CSM 0x02 option missing from picker');
      if ((await chip.textContent())?.trim() !== 'CSM 0x02') {
        throw new Error(`Unexpected label: ${await chip.textContent()}`);
      }
      // Mainnet has no CSM_02 entry in the SDK's MODULE_CONFIG, so the probe
      // resolves false without any RPC — deterministic regardless of chain state.
      if (!(await chip.isDisabled())) throw new Error('CSM 0x02 should be disabled on Mainnet');

      await page.close();
    });

    const { passed, failed } = summary();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } finally {
    await context.close();
  }

  process.exit(summary().failed > 0 ? 1 : 0);
}

main();
