/**
 * E2E: Gate proofs — gate attachments on the Shared tab and the connected bar.
 *
 * Run: npx tsx test/e2e/gate-proofs.e2e.ts
 * Requires: pnpm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedGates,
  seedState,
  seedModuleAvailability,
  goToTab,
  fillSearch,
  createRunner,
} from './helpers.js';
import type { CachedGate, CachedOperator } from '../../lib/shared/types.js';

const GATE_ONLY = '0x1111111111111111111111111111111111111111';
const OP_AND_GATE = '0x2222222222222222222222222222222222222222';
const REWARDS = '0x3333333333333333333333333333333333333333';

const CSM_OPS: CachedOperator[] = [
  {
    id: '12', managerAddress: OP_AND_GATE, rewardsAddress: REWARDS,
    extendedManagerPermissions: true,
    curveId: '0', operatorType: 'CSM_DEF',
  },
];

const ICS: CachedGate = {
  gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS',
  paused: false, unconsumed: [GATE_ONLY, OP_AND_GATE], leafCount: 5,
};

const ERRORED: CachedGate = {
  gate: 'idvtcGate', label: 'IDVTC', curveId: '', operatorType: 'CC',
  paused: false, unconsumed: [], leafCount: 0, error: 'No tree URL served a tree matching the on-chain root',
};

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  async function seedFresh() {
    await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
    await seedOperators(sw, CSM_OPS, 1, 'csm');
    await seedOperators(sw, [], 1, 'cm');
    await seedGates(sw, [ICS], 1, 'csm');
    await seedGates(sw, [], 1, 'cm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: true });
  }

  async function openShared() {
    const page = await openPopup(context, extensionId);
    await goToTab(page, 'Shared');
    return page;
  }

  try {
    await test('An operator address with an unused proof is shared under All', async () => {
      await seedFresh();
      const page = await openShared();
      const card = page.locator('.addr-card', { hasText: OP_AND_GATE.slice(0, 6) });
      await card.waitFor();
      const count = await card.locator('.attach-count').innerText();
      if (count.trim() !== '1 CSM · ICS') throw new Error(`count: ${count}`);
      if (await page.locator('.addr-card', { hasText: GATE_ONLY.slice(0, 6) }).count()) {
        throw new Error('gate-only address leaked into All');
      }
      await page.close();
    });

    await test('The Gate chip lists the gate-only address', async () => {
      await seedFresh();
      const page = await openShared();
      await page.locator('.filter-btn', { hasText: 'Gate' }).click();
      await page.locator('.addr-card', { hasText: GATE_ONLY.slice(0, 6) }).waitFor();
      await page.close();
    });

    await test('The filter bar fits the popup with five chips', async () => {
      // Widest real bar: a non-fresh staleness label plus the gate-error warning icon,
      // not the just-seeded, warning-free state `seedFresh()` gives every other test.
      const staleAt = Date.now() - 25 * 60 * 1000; // under STALE_MS (30min) — no refetch
      await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
      await seedOperators(sw, CSM_OPS, 1, 'csm', staleAt);
      await seedOperators(sw, [], 1, 'cm', staleAt);
      await seedGates(sw, [ICS, ERRORED], 1, 'csm', staleAt);
      await seedGates(sw, [], 1, 'cm', staleAt);
      await seedModuleAvailability(sw, 1, { csm: true, cm: true });

      const page = await openShared();
      await page.locator('.staleness-label').waitFor();
      await page.locator('.gate-warn').waitFor();
      const overflow = await page.locator('.filter-bar').evaluate((el) => el.scrollWidth - el.clientWidth);

      // The staleness label can shrink to absorb overflow — a fitting bar can still
      // hide it entirely. Confirm it stays fully legible, not just present.
      const labelOverflow = await page
        .locator('.staleness-label')
        .evaluate((el) => el.scrollWidth - el.clientWidth);

      const chipHeights = await page.locator('.filter-btn').evaluateAll((els) => els.map((el) => el.offsetHeight));
      console.log(`  (measured: bar overflow ${overflow}px, label overflow ${labelOverflow}px, chip heights ${chipHeights.join(',')})`);

      if (overflow > 0) throw new Error(`filter bar overflows by ${overflow}px`);
      if (labelOverflow > 0) throw new Error(`staleness label truncated by ${labelOverflow}px`);
      if (new Set(chipHeights).size > 1) throw new Error(`filter chips wrapped: heights ${chipHeights.join(', ')}`);
      await page.close();
    });

    await test('@ics finds gate addresses', async () => {
      await seedFresh();
      const page = await openShared();
      await page.locator('.filter-btn', { hasText: 'Gate' }).click();
      await fillSearch(page, '@ics');
      await page.locator('.addr-card').first().waitFor();
      const n = await page.locator('.addr-card').count();
      if (n !== 2) throw new Error(`expected 2 cards, got ${n}`);
      await page.close();
    });

    await test('Selecting a gate row connects the address; the hover lists the gate', async () => {
      await seedFresh();
      const page = await openShared();
      await page.locator('.filter-btn', { hasText: 'Gate' }).click();
      const card = page.locator('.addr-card', { hasText: GATE_ONLY.slice(0, 6) });
      await card.locator('.addr-head').click();
      const row = card.locator('.attach-row.gate');
      await row.waitFor();
      if ((await row.locator('.role-pill').innerText()).trim() !== 'PROOF') throw new Error('missing PROOF pill');
      await row.click();
      const trigger = page.locator('.ops-trigger');
      await trigger.waitFor();
      if ((await trigger.innerText()).trim() !== 'ICS') throw new Error('trigger label');
      if ((await page.locator('.ops-pop .attach-row.gate').count()) !== 1) throw new Error('hover gate row missing');
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
