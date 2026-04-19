import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWalletController } from './wallet-controller.js';
import type { LaunchOptions, LaunchResult } from './types.js';

export type { WalletController, LaunchOptions, LaunchResult, SetupOptions, SigningMode, AddressSource } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_EXTENSION_PATH = resolve(__dirname, '../extension');

/**
 * Launch Chromium with the CSM Dev Wallet extension loaded.
 *
 * Returns a browser context and a {@link WalletController} for programmatic
 * wallet interaction — no manual popup clicks needed.
 *
 * @example
 * ```ts
 * import { launch } from 'csm-dev-wallet/playwright';
 *
 * const { context, wallet } = await launch();
 * await wallet.setup({
 *   origin: 'http://localhost:3000',
 *   network: 1,
 *   account: '0xabc...',
 *   signingMode: 'approve',
 * });
 *
 * const page = await context.newPage();
 * await page.goto('http://localhost:3000');
 * ```
 */
export async function launch(options?: LaunchOptions): Promise<LaunchResult> {
  const extensionPath = options?.extensionPath ?? BUNDLED_EXTENSION_PATH;
  const headless = options?.headless ?? true;

  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-default-apps',
      ...(headless ? ['--headless=new'] : []),
    ],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extensionId = sw.url().split('/')[2];

  const wallet = createWalletController(sw, extensionId);
  return { context, wallet, extensionId };
}
