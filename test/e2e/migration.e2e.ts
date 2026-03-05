/**
 * E2E: Legacy migration — verifies wallet_state is split into global_settings + site_states.
 *
 * Run: npx tsx test/e2e/migration.e2e.ts
 * Requires: npm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedModuleAvailability,
  makeTestOperators,
  createRunner,
  clearStorage,
} from './helpers.js';

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  const operators = makeTestOperators(3);

  try {
    // ── Test 1: Legacy wallet_state is migrated on popup open ──

    await test('Legacy wallet_state migrated to split storage', async () => {
      // Seed legacy format directly
      await clearStorage(sw);
      await sw.evaluate(async () => {
        await chrome.storage.local.set({
          wallet_state: {
            chainId: 1,
            moduleType: 'csm',
            selectedAddress: null,
            isConnected: false,
            customRpcUrls: {},
            favorites: ['csm:1:1', 'csm:1:2'],
            manualAddresses: ['0x1111111111111111111111111111111111111111'],
            addressLabels: {},
            requireApproval: false,
          },
        });
      });

      await seedOperators(sw, operators, 1, 'csm');
      await seedModuleAvailability(sw, 1, { csm: true, cm: false });

      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Verify favorites survived — stars should be active for #1 and #2
      const activeStars = await page.locator('.btn-star.active').count();
      if (activeStars !== 2) throw new Error(`Expected 2 active stars, got ${activeStars}`);

      // Check storage keys via service worker
      const keys = await sw.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        return Object.keys(all);
      });

      if (keys.includes('wallet_state')) {
        throw new Error('wallet_state should be removed after migration');
      }
      if (!keys.includes('global_settings')) {
        throw new Error('global_settings should exist after migration');
      }
      if (!keys.includes('site_states')) {
        throw new Error('site_states should exist after migration');
      }

      // Verify global_settings content
      const global = await sw.evaluate(async () => {
        const data = await chrome.storage.local.get('global_settings');
        return data.global_settings;
      });

      if (!Array.isArray(global.favorites) || global.favorites.length !== 2) {
        throw new Error(`Expected 2 favorites, got ${JSON.stringify(global.favorites)}`);
      }
      if (!Array.isArray(global.manualAddresses) || global.manualAddresses.length !== 1) {
        throw new Error(`Expected 1 manual address, got ${JSON.stringify(global.manualAddresses)}`);
      }

      await page.close();
    });

    // ── Test 2: Bare favorite IDs are scoped during migration ──

    await test('Bare favorite IDs scoped during migration', async () => {
      await clearStorage(sw);
      await sw.evaluate(async () => {
        await chrome.storage.local.set({
          wallet_state: {
            chainId: 1,
            moduleType: 'csm',
            selectedAddress: null,
            isConnected: false,
            customRpcUrls: {},
            favorites: ['1', '3'], // legacy bare IDs
            manualAddresses: [],
            addressLabels: {},
            requireApproval: false,
          },
        });
      });

      await seedOperators(sw, operators, 1, 'csm');
      await seedModuleAvailability(sw, 1, { csm: true, cm: false });

      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      const global = await sw.evaluate(async () => {
        const data = await chrome.storage.local.get('global_settings');
        return data.global_settings;
      });

      const expected = ['csm:1:1', 'csm:1:3'];
      const actual = global.favorites as string[];
      if (actual.length !== 2 || !expected.every((e) => actual.includes(e))) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }

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
