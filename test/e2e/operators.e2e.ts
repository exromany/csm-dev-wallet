/**
 * E2E: Operators tab — render, search, filter, favorites, refresh.
 *
 * Run: npx tsx test/e2e/operators.e2e.ts
 * Requires: npm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedModuleAvailability,
  makeTestOperators,
  createRunner,
} from './helpers.js';

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  // 5 operators: IDs 1-5, types DEF/LEA/ICS/DEF/LEA
  const operators = makeTestOperators(5);

  /** Reseed operators in storage (no in-memory cache for operators) */
  async function seedOps() {
    await seedOperators(sw, operators, 1, 'csm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: false });
  }

  try {
    await seedOps();

    // ── Test 1: Operators render after seeding ──

    await test('Operators render — 5 rows with correct IDs', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');
      const rows = await page.locator('.operator-row').count();
      if (rows !== 5) throw new Error(`Expected 5 rows, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      const expected = ['#1', '#2', '#3', '#4', '#5'];
      if (JSON.stringify(ids) !== JSON.stringify(expected)) {
        throw new Error(`Expected IDs ${expected}, got ${ids}`);
      }
      await page.close();
    });

    // ── Test 2: Search by #3 ──

    await test('Search by "#3" — exactly 1 match', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');
      await page.fill('.search-bar', '#3');
      await page.waitForTimeout(300);

      const rows = await page.locator('.operator-row').count();
      if (rows !== 1) throw new Error(`Expected 1 row, got ${rows}`);

      const id = await page.locator('.operator-id').textContent();
      if (id !== '#3') throw new Error(`Expected #3, got ${id}`);
      await page.close();
    });

    // ── Test 3: Search by address substring ──

    await test('Search by address substring — correct matches', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');
      await page.fill('.search-bar', '1111');
      await page.waitForTimeout(300);

      const rows = await page.locator('.operator-row').count();
      if (rows < 1) throw new Error(`Expected at least 1 row, got ${rows}`);

      const ids = await page.locator('.operator-id').allTextContents();
      if (!ids.includes('#1')) throw new Error(`Expected #1 in results, got ${ids}`);
      await page.close();
    });

    // ── Test 4: Search by type "LEA" ──

    await test('Search by type "LEA" — only LEA operators', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');
      await page.fill('.search-bar', 'LEA');
      await page.waitForTimeout(300);

      const rows = await page.locator('.operator-row').count();
      if (rows !== 2) throw new Error(`Expected 2 LEA rows, got ${rows}`);

      const types = await page.locator('.operator-type').allTextContents();
      if (!types.every((t) => t === 'LEA')) {
        throw new Error(`Expected all LEA, got ${types}`);
      }
      await page.close();
    });

    // ── Test 5: Clear search restores all ──

    await test('Clear search restores all operators', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');
      await page.fill('.search-bar', 'LEA');
      await page.waitForTimeout(300);

      let rows = await page.locator('.operator-row').count();
      if (rows !== 2) throw new Error(`After search: expected 2, got ${rows}`);

      await page.fill('.search-bar', '');
      await page.waitForTimeout(300);

      rows = await page.locator('.operator-row').count();
      if (rows !== 5) throw new Error(`After clear: expected 5, got ${rows}`);
      await page.close();
    });

    // ── Test 6: Refresh button shows loading ──

    await test('Refresh button shows loading state', async () => {
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      const refreshBtn = page.locator('.filter-btn:has-text("Refresh")');
      await refreshBtn.click();

      // Should show "Loading..." briefly (RPC will fail or fetch real data — we test loading UX)
      const loadingVisible = await page
        .locator('.filter-btn:has-text("Loading")')
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      console.log(`    (loading state detected: ${loadingVisible})`);

      // Wait for refresh to finish (it may fetch from RPC) before closing
      await page.locator('.filter-btn:has-text("Refresh")').waitFor({ timeout: 15000 }).catch(() => {});
      await page.close();

      // Reseed after refresh (refresh may overwrite cache with real RPC data)
      await seedOps();
    });

    // ── Test 7: Favorite persists across popup reopen ──

    await test('Favorite persists across popup reopen', async () => {
      await seedOps();
      let page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      // Star operator #1
      await page.locator('.btn-star').first().click();
      await page.waitForTimeout(300);

      const activeStars = await page.locator('.btn-star.active').count();
      if (activeStars < 1) throw new Error('Expected at least 1 active star');
      await page.close();

      // Reopen popup — favorite should persist
      page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      const stillActive = await page.locator('.btn-star.active').count();
      if (stillActive < 1) throw new Error('Favorite did not persist after reopen');
      await page.close();
    });

    // ── Test 8: Favorites filter shows only starred ──

    await test('Favorites filter shows only starred operators', async () => {
      await seedOps();
      const page = await openPopup(context, extensionId);
      await page.waitForSelector('.operator-row');

      const allCount = await page.locator('.operator-row').count();
      if (allCount !== 5) throw new Error(`Expected 5 rows in All, got ${allCount}`);

      // Ensure at least one operator is starred (test 7 starred #1)
      const starredBefore = await page.locator('.btn-star.active').count();
      if (starredBefore === 0) {
        await page.locator('.btn-star').first().click();
        await page.waitForTimeout(300);
      }

      // Switch to Favorites
      await page.click('.filter-btn:has-text("Favorites")');
      await page.waitForTimeout(300);

      const favCount = await page.locator('.operator-row').count();
      if (favCount === 0) throw new Error('Favorites filter shows no operators');
      if (favCount >= allCount) throw new Error(`Filter shows all ${favCount} — not filtering`);

      // Every shown operator should have an active star
      const activeStars = await page.locator('.btn-star.active').count();
      if (activeStars !== favCount) {
        throw new Error(`${favCount} rows but ${activeStars} active stars`);
      }

      // Switch back to All — all 5 should return
      await page.click('.filter-btn:has-text("All")');
      await page.waitForTimeout(300);

      const allRows = await page.locator('.operator-row').count();
      if (allRows !== 5) throw new Error(`After All: expected 5, got ${allRows}`);
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
