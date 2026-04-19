import type { Address } from 'viem';
import type { BrowserContext, Page, Worker } from 'playwright';

/**
 * Controls how the wallet responds to signing requests (`eth_sendTransaction`,
 * `eth_signTypedData_v4`, `personal_sign`, `eth_sign`).
 *
 * - `'approve'` — auto-sign via Anvil impersonation, no popup
 * - `'reject'`  — auto-reject with EIP-1193 code 4001 (user denied)
 * - `'error'`   — simulate RPC failure with code -32603
 * - `'prompt'`  — normal popup behavior (default)
 */
export type SigningMode = 'approve' | 'reject' | 'error' | 'prompt';

/**
 * Describes where an address came from — used for bookkeeping in wallet state.
 */
export type AddressSource =
  | { type: 'operator'; operatorId: string; role: string }
  | { type: 'anvil'; index: number }
  | { type: 'manual' };

/**
 * Options for {@link WalletController.setup}. Call before navigating to the dapp.
 *
 * @example
 * ```ts
 * await wallet.setup({
 *   origin: 'http://localhost:3000',
 *   network: 1,
 *   account: '0xabc...',
 *   signingMode: 'approve',
 * });
 * ```
 */
export type SetupOptions = {
  /** Dapp origin to pre-configure (e.g. `'http://localhost:3000'`). */
  origin: string;
  /** Chain ID to connect on. Defaults to 1 (mainnet). */
  network?: number;
  /** Address to auto-connect. When set, the dapp sees the wallet as already connected. */
  account?: Address;
  /** Metadata for the connected address. Defaults to `{ type: 'manual' }`. */
  accountSource?: AddressSource;
  /** How the wallet handles signing requests. Defaults to `'prompt'`. */
  signingMode?: SigningMode;
  /** Operator objects to seed into the extension's cache. */
  operators?: unknown[];
  /** Chain ID for the seeded operators. Defaults to {@link network} ?? 1. */
  operatorsChainId?: number;
  /** Module type for the seeded operators. Defaults to `'csm'`. */
  operatorsModuleType?: string;
  /** Which operator modules are available (e.g. `{ csm: true, cm: false }`). */
  moduleAvailability?: { csm: boolean; cm: boolean };
  /** Chain ID for module availability. Defaults to {@link network} ?? 1. */
  moduleAvailabilityChainId?: number;
};

/**
 * Options for {@link launch}.
 */
export type LaunchOptions = {
  /**
   * Path to the built extension directory.
   * Defaults to the bundled extension shipped with the npm package.
   * For local dev: `'.output/chrome-mv3'`.
   */
  extensionPath?: string;
  /** Run in headless mode. Defaults to `true`. */
  headless?: boolean;
};

/**
 * Returned by {@link launch}.
 */
export type LaunchResult = {
  /** The Playwright browser context with the extension loaded. */
  context: BrowserContext;
  /** Controller for programmatic wallet interaction. */
  wallet: WalletController;
  /** The Chrome extension ID (derived from the service worker URL). */
  extensionId: string;
};

/**
 * Programmatic controller for the CSM Dev Wallet extension.
 *
 * Use {@link setup} before page navigation to pre-configure wallet state
 * (talks directly to the service worker). Use the other methods mid-test
 * to change state via `wallet_test*` RPC calls on the page.
 *
 * @example
 * ```ts
 * import { launch } from 'csm-dev-wallet/playwright';
 *
 * const { context, wallet } = await launch();
 * await wallet.setup({ origin: 'http://localhost:3000', network: 1, account: '0x...' });
 *
 * const page = await context.newPage();
 * await page.goto('http://localhost:3000');
 *
 * await wallet.switchNetwork(page, 560048);
 * await wallet.setSigningMode(page, 'approve');
 * ```
 */
export interface WalletController {
  /**
   * Pre-configure wallet state before navigating to the dapp.
   * Talks directly to the service worker — no page required.
   */
  setup(options: SetupOptions): Promise<void>;

  /** Switch the active account. Emits `accountsChanged` on the page. */
  switchAccount(page: Page, address: Address, source?: AddressSource): Promise<void>;

  /** Switch the active chain. Emits `chainChanged` on the page. */
  switchNetwork(page: Page, chainId: number): Promise<void>;

  /** Connect the wallet, optionally with a specific address. */
  connect(page: Page, address?: Address, source?: AddressSource): Promise<void>;

  /** Disconnect the wallet. Emits `accountsChanged([])` on the page. */
  disconnect(page: Page): Promise<void>;

  /** Change how signing requests are handled mid-test. */
  setSigningMode(page: Page, mode: SigningMode): Promise<void>;

  /** Read the current composed wallet state. */
  getState(page: Page): Promise<Record<string, unknown>>;

  /** Inject operators into the extension's cache via RPC. */
  seedOperators(page: Page, operators: unknown[], chainId: number, moduleType?: string): Promise<void>;

  /** The extension's service worker instance. */
  readonly sw: Worker;

  /** The Chrome extension ID. */
  readonly extensionId: string;
}
