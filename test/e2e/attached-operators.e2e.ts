/**
 * E2E: Attached-operators panel — count pill, cross-module tint, hover reveal.
 *
 * Run: npx tsx test/e2e/attached-operators.e2e.ts
 * Requires: pnpm run build first
 */
import type { Page } from 'playwright';
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedState,
  seedModuleAvailability,
  clearStorage,
  goToTab,
  clickAdd,
  clickManualRow,
  createRunner,
} from './helpers.js';
import type { CachedOperator } from '../../lib/shared/types.js';

const CROSS = '0x1111111111111111111111111111111111111111';
const SOLO = '0x2222222222222222222222222222222222222222';
const CSM_TWO = '0x3333333333333333333333333333333333333333';
const FILLER1 = '0x4444444444444444444444444444444444444444';
const FILLER2 = '0x5555555555555555555555555555555555555555';
const FILLER3 = '0x6666666666666666666666666666666666666666';
const FILLER4 = '0x7777777777777777777777777777777777777777';
const FILLER5 = '0x8888888888888888888888888888888888888888';
const UNATTACHED = '0x9999999999999999999999999999999999999999';

const CSM_OPS: CachedOperator[] = [
  {
    id: '12', managerAddress: CROSS, rewardsAddress: FILLER1,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  {
    id: '13', managerAddress: FILLER2, rewardsAddress: CROSS,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  {
    id: '20', managerAddress: CSM_TWO, rewardsAddress: FILLER3,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  {
    id: '21', managerAddress: FILLER4, rewardsAddress: CSM_TWO,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  {
    id: '30', managerAddress: SOLO, rewardsAddress: FILLER5,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CSM_DEF',
  },
];

const CM_OPS: CachedOperator[] = [
  {
    id: '7', managerAddress: CROSS, rewardsAddress: FILLER1,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CM_PO',
  },
];

const { test, summary } = createRunner();

async function connectViaShared(page: Page, address: string) {
  await goToTab(page, 'Shared');
  await page.waitForSelector('.addr-card');
  const card = page.locator('.addr-card', { hasText: address.slice(0, 6) });
  await card.locator('.addr-head').click();
  await card.locator('.attach-row').first().waitFor();
  await card.locator('.attach-row').first().click();
  await waitForSettledTrigger(page);
}

async function connectViaManual(page: Page, address: string) {
  await goToTab(page, 'Manual');
  await page.fill('.manual-form .addr-input', address);
  await clickAdd(page);
  await page.waitForSelector('.manual-entry');
  await clickManualRow(page);
  await page.waitForSelector('.connected-pill');
}

/**
 * Waits for `.ops-trigger` and returns its settled text.
 *
 * Module availability starts unknown, so useSharedAddresses can legitimately
 * finish loading on CSM alone, render the trigger with an under-counted total,
 * then reset and refetch once the other modules' availability resolves a beat
 * later (see its "hold off every request" comment). A `.pending-count` element never satisfies
 * `.ops-trigger`, so waiting on it alone isn't enough — poll until the text
 * stops moving so tests read the fully-settled count, not the first paint.
 */
async function waitForSettledTrigger(page: Page, timeoutMs = 5000): Promise<string> {
  await page.waitForSelector('.ops-trigger', { timeout: timeoutMs });
  const trigger = page.locator('.ops-trigger');
  const deadline = Date.now() + timeoutMs;
  let prev: string | null = null;
  while (Date.now() < deadline) {
    const cur = (await trigger.innerText()).trim();
    if (cur === prev) return cur;
    prev = cur;
    await page.waitForTimeout(150);
  }
  return prev ?? '';
}

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  async function seedFresh() {
    await clearStorage(sw);
    await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
    await seedOperators(sw, CSM_OPS, 1, 'csm');
    await seedOperators(sw, CM_OPS, 1, 'cm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: true });
  }

  try {
    await test('No pill for an unattached address', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaManual(page, UNATTACHED);
      // Let the transient loading indicator (if any) resolve before asserting absence.
      await page.waitForSelector('.pending-count', { state: 'detached', timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);

      const count = await page.locator('.connected-pill .attach-count').count();
      if (count !== 0) throw new Error(`expected no attach-count element, found ${count}`);
      await page.close();
    });

    await test('Cross-module address shows the total count with the cross tint', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaShared(page, CROSS);

      const text = await waitForSettledTrigger(page);
      if (text !== '3 ops') throw new Error(`expected "3 ops", got "${text}"`);

      const cls = await page.locator('.ops-trigger').getAttribute('class');
      if (!cls?.includes('cross')) throw new Error(`expected cross class, got "${cls}"`);
      await page.close();
    });

    await test('CSM-only address shows its count without the cross tint', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaShared(page, CSM_TWO);

      const text = await waitForSettledTrigger(page);
      if (text !== '2 ops') throw new Error(`expected "2 ops", got "${text}"`);

      const cls = await page.locator('.ops-trigger').getAttribute('class');
      if (cls?.includes('cross')) throw new Error(`did not expect cross class, got "${cls}"`);
      await page.close();
    });

    await test('Singular label for a single attachment', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaManual(page, SOLO);

      const text = await waitForSettledTrigger(page);
      if (text !== '1 op') throw new Error(`expected "1 op", got "${text}"`);
      await page.close();
    });

    await test('Hover opens the panel with one row per attachment', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaShared(page, CROSS);

      const pop = page.locator('.ops-pop');
      if (await pop.isVisible()) throw new Error('panel should be hidden at rest');

      await waitForSettledTrigger(page);
      await page.locator('.ops-trigger').hover();
      await page.waitForTimeout(200);

      if (!(await pop.isVisible())) throw new Error('panel should be visible after hover');

      const rows = pop.locator('.attach-row');
      const rowCount = await rows.count();
      if (rowCount !== 3) throw new Error(`expected 3 rows, got ${rowCount}`);

      const text = await pop.innerText();
      if (!text.includes('#12')) throw new Error(`missing #12 row: "${text}"`);
      if (!text.includes('CSM·DEF')) throw new Error(`missing CSM·DEF badge: "${text}"`);
      if (!text.includes('CM·PO')) throw new Error(`missing CM·PO badge: "${text}"`);
      await page.close();
    });

    await test('Hover survives the trip from the trigger into a row', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaShared(page, CROSS);

      await page.locator('.ops-trigger').hover();
      await page.waitForTimeout(200);

      // The real point of this test: move the mouse onto a row via .hover(),
      // not a plain click — that's the travel the ::before bridge exists for.
      await page.locator('.ops-pop .attach-row').first().hover();
      await page.waitForTimeout(100);

      if (!(await page.locator('.ops-pop').isVisible())) {
        throw new Error('panel closed while moving the pointer into a row');
      }
      await page.close();
    });

    await test('Not capped at three attachments', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaShared(page, CROSS);

      const cls = await page.locator('.ops-pop').getAttribute('class');
      if (cls?.includes('capped')) throw new Error(`expected no capped class, got "${cls}"`);
      await page.close();
    });

    await test('Clicking a CM row in the panel connects it and switches the module', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await connectViaShared(page, CROSS);

      await page.locator('.ops-trigger').hover();
      await page.waitForSelector('.ops-pop .attach-row');

      const cmRow = page.locator('.ops-pop .attach-row', { hasText: 'CM·PO' });
      await cmRow.click();
      await page.waitForTimeout(400);

      const chip = await page.locator('.netmod-chip .mod-label').innerText();
      if (chip !== 'CM') throw new Error(`expected module chip to read CM, got "${chip}"`);

      const pill = await page.locator('.connected-pill').innerText();
      if (!pill.toLowerCase().includes(CROSS.slice(0, 6).toLowerCase())) {
        throw new Error(`connected pill does not show the address: ${pill}`);
      }
      await page.close();
    });
  } finally {
    await context.close();
  }

  const { passed, failed } = summary();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
