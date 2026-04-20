import type { Page, Worker } from 'playwright';
import type { Address } from 'viem';
import type { WalletController, SetupOptions, SigningMode, AddressSource, AddressRole } from './types.js';

export function createWalletController(sw: Worker, extensionId: string): WalletController {
  async function resetCaches() {
    await sw.evaluate(() => {
      (self as any).__resetStateCaches?.();
    });
  }

  async function setup(options: SetupOptions) {
    await resetCaches();
    const { origin } = options;

    // Seed site state
    const siteState: Record<string, unknown> = {};
    if (options.network !== undefined) siteState.chainId = options.network;
    if (options.account) {
      siteState.selectedAddress = {
        address: options.account,
        source: options.accountSource ?? { type: 'manual' },
      };
      siteState.isConnected = true;
    }

    if (Object.keys(siteState).length > 0) {
      await sw.evaluate(
        async ([o, patch]) => {
          const defaults = { chainId: 1, moduleType: 'csm', selectedAddress: null, isConnected: false };
          const data = await chrome.storage.local.get('site_states');
          const sites = (data.site_states ?? {}) as Record<string, Record<string, unknown>>;
          const current = sites[o] ?? defaults;
          await chrome.storage.local.set({ site_states: { ...sites, [o]: { ...current, ...patch } } });
        },
        [origin, siteState] as const,
      );
      await resetCaches();
    }

    // Seed signing mode via sw global (read by getSigningMode in test-rpc.ts)
    if (options.signingMode && options.signingMode !== 'prompt') {
      await sw.evaluate((mode) => {
        (self as any).__testSigningMode = mode;
      }, options.signingMode);
    }

    // Seed operators
    if (options.operators) {
      const chainId = options.operatorsChainId ?? options.network ?? 1;
      const moduleType = options.operatorsModuleType ?? 'csm';
      const key = `operators_${moduleType}_${chainId}`;
      await sw.evaluate(
        async ([k, ops]) => {
          await chrome.storage.local.set({ [k]: { operators: ops, lastFetchedAt: Date.now() } });
        },
        [key, options.operators] as const,
      );
    }

    // Seed module availability
    if (options.moduleAvailability) {
      const chainId = options.moduleAvailabilityChainId ?? options.network ?? 1;
      const key = `module_availability_${chainId}`;
      await sw.evaluate(
        async ([k, mods]) => {
          await chrome.storage.local.set({ [k]: { ...mods, checkedAt: Date.now() } });
        },
        [key, options.moduleAvailability] as const,
      );
    }
  }

  function rpc(page: Page, method: string, params?: unknown[]) {
    return page.evaluate(
      ([m, p]) => (window as any).ethereum.request({ method: m, params: p }),
      [method, params ?? []] as const,
    );
  }

  return {
    setup,
    async switchAccount(page: Page, address: Address, source?: AddressSource) {
      await rpc(page, 'wallet_testSetAccount', [{ address, source }]);
    },
    async switchNetwork(page: Page, chainId: number) {
      await rpc(page, 'wallet_testSetNetwork', [{ chainId }]);
    },
    async connect(page: Page, address?: Address, source?: AddressSource) {
      await rpc(page, 'wallet_testConnect', [{ address, source }]);
    },
    async disconnect(page: Page) {
      await rpc(page, 'wallet_testDisconnect');
    },
    async setSigningMode(page: Page, mode: SigningMode) {
      await rpc(page, 'wallet_testSetSigningMode', [{ mode }]);
    },
    async getState(page: Page) {
      return rpc(page, 'wallet_testGetState') as Promise<Record<string, unknown>>;
    },
    async seedOperators(page: Page, operators: unknown[], chainId: number, moduleType = 'csm') {
      await rpc(page, 'wallet_testSeedOperators', [{ operators, chainId, moduleType }]);
    },
    async getOperators(page: Page, chainId?: number, moduleType?: string) {
      const params = chainId !== undefined || moduleType !== undefined
        ? [{ chainId, moduleType }]
        : [];
      return rpc(page, 'wallet_testGetOperators', params) as Promise<unknown[] | null>;
    },
    async getOperator(page: Page, operatorId: string, chainId?: number, moduleType?: string) {
      return rpc(page, 'wallet_testGetOperator', [{ operatorId, chainId, moduleType }]) as Promise<Record<string, unknown>>;
    },
    async selectOperator(page: Page, operatorId: string, role: AddressRole, chainId?: number, moduleType?: string) {
      await rpc(page, 'wallet_testSetOperatorAccount', [{ operatorId, role, chainId, moduleType }]);
    },
    async setRpcUrl(page: Page, chainId: number, rpcUrl: string) {
      await rpc(page, 'wallet_testSetRpcUrl', [{ chainId, rpcUrl }]);
    },
    async refreshOperators(page: Page, chainId?: number, moduleType?: string, rpcUrl?: string) {
      return rpc(page, 'wallet_testRefreshOperators', [{ chainId, moduleType, rpcUrl }]) as Promise<unknown[]>;
    },
    get sw() { return sw; },
    get extensionId() { return extensionId; },
  };
}
