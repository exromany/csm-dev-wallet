import type { Address } from 'viem';
import type { BrowserContext, Page, Worker } from 'playwright';

export type SigningMode = 'approve' | 'reject' | 'error' | 'prompt';

export type AddressSource =
  | { type: 'operator'; operatorId: string; role: string }
  | { type: 'anvil'; index: number }
  | { type: 'manual' };

export type SetupOptions = {
  origin: string;
  network?: number;
  account?: Address;
  accountSource?: AddressSource;
  signingMode?: SigningMode;
  operators?: unknown[];
  operatorsChainId?: number;
  operatorsModuleType?: string;
  moduleAvailability?: { csm: boolean; cm: boolean };
  moduleAvailabilityChainId?: number;
};

export type LaunchOptions = {
  extensionPath?: string;
  headless?: boolean;
};

export type LaunchResult = {
  context: BrowserContext;
  wallet: WalletController;
  extensionId: string;
};

export interface WalletController {
  setup(options: SetupOptions): Promise<void>;
  switchAccount(page: Page, address: Address, source?: AddressSource): Promise<void>;
  switchNetwork(page: Page, chainId: number): Promise<void>;
  connect(page: Page, address?: Address, source?: AddressSource): Promise<void>;
  disconnect(page: Page): Promise<void>;
  setSigningMode(page: Page, mode: SigningMode): Promise<void>;
  getState(page: Page): Promise<Record<string, unknown>>;
  seedOperators(page: Page, operators: unknown[], chainId: number, moduleType?: string): Promise<void>;
  readonly sw: Worker;
  readonly extensionId: string;
}
