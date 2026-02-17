/**
 * E2E: Manual addresses tab — add, validate, select, remove.
 *
 * Run: npx tsx test/e2e/manual-addresses.e2e.ts
 * Requires: npm run build first
 */
import {
  launchExtension,
  openPopup,
  goToTab,
  createRunner,
} from './helpers.js';

const { test, summary } = createRunner();

const VALID_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const INVALID_ADDRESS = '0xinvalid';

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId } = await launchExtension();

  try {
    // ── Test 1: Empty state message visible ──

    await test('Empty state shows message', async () => {
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Manual');

      const emptyState = page.locator('.empty-state');
      const visible = await emptyState.isVisible();
      if (!visible) throw new Error('Empty state message not visible');

      const text = await emptyState.textContent();
      if (!text?.includes('No manual addresses')) {
        throw new Error(`Unexpected empty state text: ${text}`);
      }
      await page.close();
    });

    // ── Test 2: Add valid address ──

    await test('Add valid address — appears in list, input clears', async () => {
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Manual');

      await page.fill('.manual-input-row input', VALID_ADDRESS);
      await page.click('.btn-add');
      await page.waitForTimeout(300);

      const inputValue = await page.locator('.manual-input-row input').inputValue();
      if (inputValue !== '') throw new Error(`Input not cleared: "${inputValue}"`);

      const emptyVisible = await page.locator('.empty-state').isVisible().catch(() => false);
      if (emptyVisible) throw new Error('Empty state still visible after adding');

      const addressText = await page.locator('.address-mono').first().textContent();
      if (!addressText) throw new Error('No address shown in list');
      await page.close();
    });

    // ── Test 3: Invalid address not added ──

    await test('Invalid address not added', async () => {
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Manual');

      // First remove any existing addresses from previous tests
      while (await page.locator('.btn-disconnect:has-text("Remove")').count() > 0) {
        await page.click('.btn-disconnect:has-text("Remove")');
        await page.waitForTimeout(200);
      }

      await page.fill('.manual-input-row input', INVALID_ADDRESS);
      await page.click('.btn-add');
      await page.waitForTimeout(300);

      const emptyVisible = await page.locator('.empty-state').isVisible();
      if (!emptyVisible) throw new Error('Invalid address was added — empty state gone');

      const inputValue = await page.locator('.manual-input-row input').inputValue();
      if (inputValue !== INVALID_ADDRESS) {
        throw new Error(`Input unexpectedly changed to: "${inputValue}"`);
      }
      await page.close();
    });

    // ── Test 4: Select address shows connected bar ──

    await test('Select address — connected bar appears', async () => {
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Manual');

      // Add an address via UI
      await page.fill('.manual-input-row input', VALID_ADDRESS);
      await page.click('.btn-add');
      await page.waitForTimeout(300);

      // Click the address row to select
      await page.click('.address-row');
      await page.waitForTimeout(500);

      const connectedBar = page.locator('.connected-bar');
      const visible = await connectedBar.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) throw new Error('Connected bar not visible after selecting address');
      await page.close();
    });

    // ── Test 5: Remove address — empty state returns ──

    await test('Remove address — empty state returns', async () => {
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Manual');

      // Ensure there's an address (add if empty)
      const emptyBefore = await page.locator('.empty-state').isVisible().catch(() => false);
      if (emptyBefore) {
        await page.fill('.manual-input-row input', VALID_ADDRESS);
        await page.click('.btn-add');
        await page.waitForTimeout(300);
      }

      // Remove all addresses
      while (await page.locator('.btn-disconnect:has-text("Remove")').count() > 0) {
        await page.click('.btn-disconnect:has-text("Remove")');
        await page.waitForTimeout(300);
      }

      const emptyVisible = await page.locator('.empty-state').isVisible();
      if (!emptyVisible) throw new Error('Empty state not visible after removal');
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
