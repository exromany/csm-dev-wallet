/**
 * Generates a Chrome Web Store screenshot (1280×800) of the popup with
 * seeded operator data, docked in a mock browser chrome.
 *
 * Run: pnpm run screenshot:store (builds first)
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchExtension, openPopup, seedOperators, seedModuleAvailability, makeTestOperators } from '../test/e2e/helpers.js';

const OUT_DIR = resolve(import.meta.dirname, '../docs/store');
const OUT_FILE = resolve(OUT_DIR, 'screenshot-operators.png');

async function main() {
  const { context, extensionId, sw } = await launchExtension();

  try {
    await seedOperators(sw, makeTestOperators(12), 1, 'csm');
    await seedModuleAvailability(sw, 1, { csm: true, cm: false });

    const page = await openPopup(context, extensionId);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForSelector('.operator-row');

    // style.css applies `min-height: 500px; max-height: 600px` to *both*
    // html and body (shared selector). Overriding html's height alone still
    // gets clamped to that inherited max-height, so html's box — and the
    // flex centering within it — only ever spans 600px instead of the full
    // viewport. Clear html's own min/max-height so `height: 800px` sticks;
    // body keeps the 600px cap so it centers as a fixed-size card.
    await page.addStyleTag({
      content: `
        html {
          width: 1280px !important;
          height: 800px !important;
          min-height: 0 !important;
          max-height: none !important;
          background: #e4e6eb;
          display: flex !important;
          justify-content: center;
          align-items: center;
        }
        body {
          margin: 0 !important;
          border-radius: 14px !important;
          overflow: hidden !important;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.08) !important;
        }
      `,
    });

    mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: OUT_FILE });
    await page.close();
  } finally {
    await context.close();
  }
}

main();
