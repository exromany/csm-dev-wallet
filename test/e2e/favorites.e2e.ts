/**
 * E2E: Favorites — star/un-star, filtering, search combo, network scoping.
 *
 * Run: npx tsx test/e2e/favorites.e2e.ts
 * Requires: npm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedState,
  seedModuleAvailability,
  makeTestOperators,
  createRunner,
} from './helpers.js';

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  const operators = makeTestOperators(5);

  async function seedFresh(favorites: string[] = []) {
    await seedState(sw, { chainId: 1, moduleType: 'csm', favorites });
    await seedOperators(sw, operators, 1, 'csm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: false });
  }

  try {
    // ── Test 1: Star and un-star toggles correctly ──

    await test('Star and un-star toggles correctly', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      const firstStar = page.locator('.operator-row').first().locator('.btn-star');
      await firstStar.click();
      await page.waitForTimeout(300);

      let isActive = await firstStar.evaluate((el) => el.classList.contains('active'));
      if (!isActive) throw new Error('Star should be active after click');

      await firstStar.click();
      await page.waitForTimeout(300);

      isActive = await firstStar.evaluate((el) => el.classList.contains('active'));
      if (isActive) throw new Error('Star should be inactive after second click');
      await page.close();
    });

    // ── Test 2: Specific operator starred ──

    await test('Specific operator starred — only #3 active', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Star operator #3 (index 2)
      await page.locator('.operator-row').nth(2).locator('.btn-star').click();
      await page.waitForTimeout(300);

      const activeStars = await page.locator('.btn-star.active').count();
      if (activeStars !== 1) throw new Error(`Expected 1 active star, got ${activeStars}`);

      // Verify it's on the #3 row
      const row = page.locator('.operator-row').nth(2);
      const starActive = await row.locator('.btn-star').evaluate((el) => el.classList.contains('active'));
      if (!starActive) throw new Error('Star on row #3 should be active');
      await page.close();
    });

    // ── Test 3: Multiple favorites filter ──

    await test('Multiple favorites — filter shows exactly 2', async () => {
      await seedFresh(['csm:1:1', 'csm:1:4']);
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Verify 2 stars active
      const activeStars = await page.locator('.btn-star.active').count();
      if (activeStars !== 2) throw new Error(`Expected 2 active stars, got ${activeStars}`);

      // Switch to Favorites filter
      await page.click('.filter-btn:has-text("Favorites")');
      await page.waitForTimeout(300);

      const rows = await page.locator('.operator-row').count();
      if (rows !== 2) throw new Error(`Expected 2 favorite rows, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      if (!ids.includes('#1') || !ids.includes('#4')) {
        throw new Error(`Expected #1 and #4, got ${ids}`);
      }
      await page.close();
    });

    // ── Test 4: Empty favorites view ──

    await test('Empty favorites — shows "No matching operators"', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      await page.click('.filter-btn:has-text("Favorites")');
      await page.waitForTimeout(300);

      const rows = await page.locator('.operator-row').count();
      if (rows !== 0) throw new Error(`Expected 0 rows, got ${rows}`);

      const emptyText = await page.locator('.empty-state').textContent();
      if (!emptyText?.includes('No matching')) {
        throw new Error(`Expected "No matching" message, got "${emptyText}"`);
      }
      await page.close();
    });

    // ── Test 5: Favorites + search combined ──

    await test('Favorites + search combined', async () => {
      // Star #2 (LEA) and #5 (LEA)
      await seedFresh(['csm:1:2', 'csm:1:5']);
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Search "LEA" — matches #2 and #5 (both LEA type)
      await page.fill('.search-bar', 'LEA');
      await page.waitForTimeout(300);

      let rows = await page.locator('.operator-row').count();
      if (rows !== 2) throw new Error(`LEA search: expected 2, got ${rows}`);

      // Now also filter by Favorites
      await page.click('.filter-btn:has-text("Favorites")');
      await page.waitForTimeout(300);

      rows = await page.locator('.operator-row').count();
      if (rows !== 2) throw new Error(`LEA + Favorites: expected 2, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      if (!ids.includes('#2') || !ids.includes('#5')) {
        throw new Error(`Expected #2 and #5, got ${ids}`);
      }
      await page.close();
    });

    // ── Test 6: Favorites scoped per network ──

    await test('Favorites scoped per network', async () => {
      // Star #1 on Mainnet
      await seedFresh(['csm:1:1']);

      // Seed Hoodi operators
      const hoodiOps = makeTestOperators(3).map((op, i) => ({
        ...op,
        id: String(101 + i),
      }));
      await seedOperators(sw, hoodiOps, 560048, 'csm');
      await seedModuleAvailability(sw, 560048, { csm: true, cm: false });

      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Verify Mainnet has 1 active star
      let activeStars = await page.locator('.btn-star.active').count();
      if (activeStars !== 1) throw new Error(`Mainnet: expected 1 active star, got ${activeStars}`);

      // Switch to Hoodi
      await page.selectOption('.network-select', '560048');
      await page.waitForTimeout(500);

      // No stars should be active on Hoodi
      activeStars = await page.locator('.btn-star.active').count();
      if (activeStars !== 0) throw new Error(`Hoodi: expected 0 active stars, got ${activeStars}`);
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
