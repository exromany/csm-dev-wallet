import type { CachedOperator, WalletState, SiteState, GlobalSettings } from '../lib/shared/types.js';

export const ADDR_A = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const;
export const ADDR_B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as const;
export const ADDR_C = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const;

export function makeOperator(overrides: Partial<CachedOperator> & { id: string }): CachedOperator {
  return {
    managerAddress: ADDR_A,
    rewardsAddress: ADDR_B,
    extendedManagerPermissions: true,
    ownerAddress: ADDR_A,
    curveId: '0',
    operatorType: 'CSM_DEF',
    ...overrides,
  };
}

export function makeState(overrides: Partial<WalletState> = {}): WalletState {
  return {
    chainId: 1,
    moduleType: 'csm',
    selectedAddress: null,
    isConnected: false,
    customRpcUrls: {},
    favorites: [],
    manualAddresses: [],
    addressLabels: {},
    requireApproval: false,
    ...overrides,
  };
}

export function makeSiteState(overrides: Partial<SiteState> = {}): SiteState {
  return {
    chainId: 1,
    moduleType: 'csm',
    selectedAddress: null,
    isConnected: false,
    ...overrides,
  };
}

export function makeGlobalSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    customRpcUrls: {},
    favorites: [],
    manualAddresses: [],
    addressLabels: {},
    requireApproval: false,
    ...overrides,
  };
}
