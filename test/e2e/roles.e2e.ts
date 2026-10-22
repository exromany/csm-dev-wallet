/**
 * E2E: Roles tab — protocol role holders, selectable as the connected address.
 *
 * Run: npx tsx test/e2e/roles.e2e.ts
 * Requires: pnpm run build first
 */
import {
  launchExtension,
  openPopup,
  seedOperators,
  seedGates,
  seedRoles,
  seedState,
  seedModuleAvailability,
  goToTab,
  createRunner,
} from './helpers.js';
import type { CachedRole } from '../../lib/shared/types.js';

const EOA_A = '0x1111111111111111111111111111111111111111';
const CONTRACT_B = '0x2222222222222222222222222222222222222222';

const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';
const TOPUP = 'ENABLE_TOP_UP_ALLOCATION_ROLE';

const CSM_ROLES: CachedRole[] = [{ role: PENALTY, holders: [{ address: EOA_A, isContract: false }] }];
const CM_ROLES: CachedRole[] = [
  { role: PENALTY, holders: [{ address: EOA_A, isContract: false }] },
  { role: TOPUP, holders: [{ address: CONTRACT_B, isContract: true }] },
];

const { test, summary } = createRunner();

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId, sw } = await launchExtension();

  async function seedFresh(cmRoles: CachedRole[] = CM_ROLES) {
    await seedState(sw, extensionId, { chainId: 1, moduleType: 'csm' });
    await seedOperators(sw, [], 1, 'csm');
    await seedOperators(sw, [], 1, 'cm');
    await seedGates(sw, [], 1, 'csm');
    await seedGates(sw, [], 1, 'cm');
    await seedRoles(sw, CSM_ROLES, 1, 'csm');
    await seedRoles(sw, cmRoles, 1, 'cm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: true });
  }

  async function openRoles() {
    const page = await openPopup(context, extensionId);
    await goToTab(page, 'Roles');
    return page;
  }

  try {
    await test('Roles tab lists both role groups', async () => {
      await seedFresh();
      const page = await openRoles();
      await page.locator('.role-group', { hasText: PENALTY }).waitFor();
      await page.locator('.role-group', { hasText: TOPUP }).waitFor();
      const n = await page.locator('.role-group').count();
      if (n !== 2) throw new Error(`expected 2 groups, got ${n}`);
      await page.close();
    });

    await test('The top-up group lists the contract holder with a contract tag', async () => {
      await seedFresh();
      const page = await openRoles();
      const row = page.locator('.role-group', { hasText: TOPUP }).locator('.role-row');
      await row.waitFor();
      const kind = (await row.locator('.role-kind').innerText()).trim();
      if (kind !== 'contract') throw new Error(`kind: ${kind}`);
      await page.close();
    });

    await test('Selecting a CM holder connects it and switches the module to CM', async () => {
      await seedFresh();
      const page = await openRoles();
      await page.locator('.role-group', { hasText: TOPUP }).locator('.role-row').click();
      await page.waitForTimeout(400);
      const pill = await page.locator('.connected-pill').innerText();
      if (!pill.toLowerCase().includes(CONTRACT_B.slice(0, 6))) throw new Error(`pill: ${pill}`);
      const chip = await page.locator('.netmod-chip .mod-label').innerText();
      if (chip !== 'CM') throw new Error(`expected module chip to read CM, got "${chip}"`);
      await page.close();
    });

    await test('An errored role shows a warning', async () => {
      await seedFresh([{ role: PENALTY, holders: [], error: 'rpc down' }, { role: TOPUP, holders: [] }]);
      const page = await openRoles();
      const note = page.locator('.role-note.error');
      await note.first().waitFor();
      if ((await note.first().getAttribute('data-hint')) !== 'rpc down') throw new Error('missing error hint');
      await page.close();
    });

    await test('Six tabs fit the tab bar on CM + Anvil', async () => {
      await seedState(sw, extensionId, { chainId: 31337, moduleType: 'cm' });
      await seedModuleAvailability(sw, 31337, { csm: true, cm: true });
      const page = await openPopup(context, extensionId);
      await page.locator('button.tab', { hasText: 'Anvil' }).waitFor();
      const count = await page.locator('button.tab').count();
      if (count !== 6) throw new Error(`expected 6 tabs, got ${count}`);
      const overflow = await page.locator('.tabs').evaluate((el) => el.scrollWidth - el.clientWidth);
      if (overflow > 0) throw new Error(`tab bar overflows by ${overflow}px`);
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
