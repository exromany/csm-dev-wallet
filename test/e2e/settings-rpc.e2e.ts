/**
 * E2E: Settings tab RPC URL persistence.
 *
 * Run: npx tsx test/e2e/settings-rpc.e2e.ts
 * Requires: npm run build first
 */
import type { BrowserContext, Page } from 'playwright';
import { launchExtension, openPopup, goToTab, createRunner } from './helpers.js';

const { test, summary } = createRunner();

async function goToSettings(page: Page) {
  await goToTab(page, 'Settings');
}

/** Set an RPC URL on a given input index, blur, and check if it persists across popup reopen */
async function testUrlPersistence(
  context: BrowserContext,
  extensionId: string,
  inputIndex: number,
  url: string,
): Promise<{ persisted: boolean; errorVisible: boolean; finalValue: string }> {
  const page = await openPopup(context, extensionId);
  await goToSettings(page);

  const input = page.locator('.settings-group input').nth(inputIndex);
  await input.fill(url);
  await input.blur();
  await page.waitForTimeout(500);

  const errorVisible = await page.locator('.error-message').count() > 0;
  await page.close();

  // Reopen and check
  const page2 = await openPopup(context, extensionId);
  await goToSettings(page2);
  const finalValue = await page2.locator('.settings-group input').nth(inputIndex).inputValue();
  await page2.close();

  return { persisted: finalValue === url, errorVisible, finalValue };
}

/** Reset all custom RPCs by clearing each input */
async function resetAllRpcs(context: BrowserContext, extensionId: string) {
  const page = await openPopup(context, extensionId);
  await goToSettings(page);
  const count = await page.locator('.settings-group input').count();
  for (let i = 0; i < count; i++) {
    const input = page.locator('.settings-group input').nth(i);
    await input.fill('');
    await input.blur();
    await page.waitForTimeout(200);
  }
  await page.close();
}

async function main() {
  console.log('Loading extension...\n');
  const { context, extensionId } = await launchExtension();

  try {
    const testUrls = [
      { url: 'https://eth.llamanodes.com', label: 'HTTPS URL', shouldSave: true },
      { url: 'https://rpc.ankr.com/eth', label: 'HTTPS with path', shouldSave: true },
      { url: 'http://127.0.0.1:8545', label: 'HTTP localhost IP', shouldSave: true },
      { url: 'http://localhost:8545', label: 'HTTP localhost name', shouldSave: true },
      { url: 'http://remote-rpc.example.com', label: 'HTTP remote', shouldSave: true },
      { url: 'wss://eth.llamanodes.com', label: 'WSS URL', shouldSave: false },
      { url: 'not-a-url', label: 'garbage string', shouldSave: false },
    ];

    for (const { url, label, shouldSave } of testUrls) {
      await test(`${label}: "${url}" → ${shouldSave ? 'saves' : 'rejected'}`, async () => {
        await resetAllRpcs(context, extensionId);

        const result = await testUrlPersistence(context, extensionId, 0, url);
        const detail = `persisted=${result.persisted}, error=${result.errorVisible}, final="${result.finalValue}"`;

        if (shouldSave && !result.persisted) {
          throw new Error(`Expected URL to save but it didn't. ${detail}`);
        }
        if (!shouldSave && result.persisted) {
          throw new Error(`Expected URL to be rejected but it saved. ${detail}`);
        }
        if (!shouldSave && !result.errorVisible) {
          console.log(`    WARNING: rejected silently (no error shown). ${detail}`);
        }

        console.log(`    (${detail})`);
      });
    }

    // Reset for clean state
    await resetAllRpcs(context, extensionId);

    const { passed, failed } = summary();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } finally {
    await context.close();
  }

  process.exit(summary().failed > 0 ? 1 : 0);
}

main();
