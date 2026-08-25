/**
 * E2E: Shared addresses — cross-module index, filters, module-switching select.
 *
 * Run: npx tsx test/e2e/shared-addresses.e2e.ts
 * Requires: pnpm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedState,
  seedModuleAvailability,
  goToTab,
  createRunner,
} from './helpers.js';
import type { CachedOperator } from '../../lib/shared/types.js';

const SHARED = '0x1111111111111111111111111111111111111111';
const SOLO = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const PROPOSED_ONLY = '0x4444444444444444444444444444444444444444';
const PROPOSED_ONLY_MGR = '0x5555555555555555555555555555555555555555';

const CSM_OPS: CachedOperator[] = [
  {
    id: '12', managerAddress: SHARED, rewardsAddress: OTHER,
    extendedManagerPermissions: true, ownerAddress: SHARED,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  {
    id: '99', managerAddress: SOLO, rewardsAddress: SOLO,
    extendedManagerPermissions: true, ownerAddress: SOLO,
    curveId: '0', operatorType: 'CSM_DEF',
  },
  // PROPOSED_ONLY's second attachment — a real rewards role, so it also
  // qualifies as shared (>1 attachment) and cross-module.
  {
    id: '13', managerAddress: PROPOSED_ONLY_MGR, rewardsAddress: PROPOSED_ONLY,
    extendedManagerPermissions: true, ownerAddress: PROPOSED_ONLY_MGR,
    curveId: '0', operatorType: 'CSM_DEF',
  },
];

const CM_OPS: CachedOperator[] = [
  {
    id: '7', managerAddress: SHARED, rewardsAddress: OTHER,
    extendedManagerPermissions: true, ownerAddress: SHARED,
    curveId: '0', operatorType: 'CM_PO',
  },
  {
    id: '44', managerAddress: OTHER, rewardsAddress: OTHER,
    proposedManagerAddress: PROPOSED_ONLY,
    extendedManagerPermissions: true, ownerAddress: OTHER,
    curveId: '0', operatorType: 'CM_EEO',
  },
];

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  async function seedFresh() {
    await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
    await seedOperators(sw, CSM_OPS, 1, 'csm');
    await seedOperators(sw, CM_OPS, 1, 'cm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: true });
  }

  try {
    await test('Lists only addresses attached to more than one operator', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      const text = await page.locator('.addr-list').innerText();
      if (!text.includes(SHARED.slice(0, 6))) throw new Error('shared address missing');
      if (text.includes(SOLO.slice(0, 6))) throw new Error('single-attachment address should not be listed');
      await page.close();
    });

    await test('Counts attachments across both modules', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      // Cards sort by attachment count descending, so SHARED (2 attachments) isn't
      // necessarily first — OTHER has 3 (csm#12 RWD, cm#7 RWD, cm#44 MGR+RWD).
      const sharedCard = page.locator('.addr-card', { hasText: SHARED.slice(0, 6) });
      const count = await sharedCard.locator('.attach-count').innerText();
      if (count !== '1 CSM · 1 CM') throw new Error(`expected "1 CSM · 1 CM", got "${count}"`);
      await page.close();
    });

    await test('Pending filter keeps only addresses with a proposed role', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      await page.click('.filter-btn:has-text("Pending")');
      await page.waitForTimeout(200);

      const text = await page.locator('.content').innerText();
      if (text.includes(SHARED.slice(0, 6))) throw new Error('non-pending address should be filtered out');
      if (!text.includes(PROPOSED_ONLY.slice(0, 6))) throw new Error('pending address should be listed');
      await page.close();
    });

    await test('Selecting a CM attachment connects it and switches the module', async () => {
      await seedFresh();
      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.addr-card');

      const sharedCard = page.locator('.addr-card', { hasText: SHARED.slice(0, 6) });
      await sharedCard.locator('.addr-head').click();
      await page.waitForSelector('.attach-row');

      const cmRow = sharedCard.locator('.attach-row', { hasText: 'CM·PO' });
      await cmRow.click();
      await page.waitForTimeout(400);

      const pill = await page.locator('.connected-pill').innerText();
      if (!pill.toLowerCase().includes(SHARED.slice(0, 6).toLowerCase())) {
        throw new Error(`connected pill does not show the address: ${pill}`);
      }

      const chip = await page.locator('.netmod-chip .mod-label').innerText();
      if (chip !== 'CM') throw new Error(`expected module chip to read CM, got "${chip}"`);
      await page.close();
    });

    await test('Falls back to CSM alone when CM is unavailable', async () => {
      // Background re-checks availability over RPC and would overwrite the seeded
      // false — CM really is deployed on mainnet. A dead RPC keeps the seed authoritative.
      await seedState(sw, extensionId, {
        chainId: 1, moduleType: 'csm', customRpcUrls: { 1: 'http://127.0.0.1:1' },
      });
      await seedOperators(sw, CSM_OPS, 1, 'csm');
      await seedModuleAvailability(sw, 1, { csm: true, cm: false });

      const page = await openPopup(context, extensionId);
      await goToTab(page, 'Shared');
      await page.waitForSelector('.scope-note');

      const note = await page.locator('.scope-note').innerText();
      if (!note.includes('CM')) throw new Error(`expected a CM-unavailable note, got "${note}"`);
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
