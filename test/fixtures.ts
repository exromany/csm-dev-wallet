import type { CachedOperator, WalletState, SiteState, GlobalSettings } from '../lib/shared/types.js';

export const ADDR_A = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const;
export const ADDR_B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as const;
export const ADDR_C = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC' as const;
export const ADDR_D = '0xDdDdddDdDDdDDDDdDdDdDDdDDdDdDDDdDddDdDDD' as const;

export function makeOperator(overrides: Partial<CachedOperator> & { id: string }): CachedOperator {
  return {
    managerAddress: ADDR_A,
    rewardsAddress: ADDR_B,
    extendedManagerPermissions: true,
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
    activeTab: 'operators',
    customRpcUrls: {},
    favorites: [],
    groupFavorites: [],
    manualAddresses: [],
    addressLabels: {},
    operatorLabels: {},
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
    activeTab: 'operators',
    ...overrides,
  };
}

export function makeGlobalSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    customRpcUrls: {},
    favorites: [],
    groupFavorites: [],
    manualAddresses: [],
    addressLabels: {},
    operatorLabels: {},
    requireApproval: false,
    ...overrides,
  };
}
