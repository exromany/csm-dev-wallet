import type { Address } from 'viem';
import type { SupportedChainId } from './networks.js';

export type ModuleType = 'csm' | 'cm';

export type CacheContext = {
  chainId: number;                  // always the cache namespace (31337 for Anvil)
  moduleType: ModuleType;
  rpcUrl: string;
  forkedFrom?: SupportedChainId;    // Anvil only — which chain's contracts to use
};

export type AddressRole =
  | 'manager'
  | 'rewards'
  | 'proposedManager'
  | 'proposedRewards';

export type AddressSource =
  | { type: 'operator'; operatorId: string; role: AddressRole }
  | { type: 'anvil'; index: number }
  | { type: 'manual' };

export type CachedOperator = {
  id: string; // bigint serialized — chrome.storage can't hold bigints
  managerAddress: Address;
  rewardsAddress: Address;
  proposedManagerAddress?: Address;
  proposedRewardsAddress?: Address;
  extendedManagerPermissions: boolean;
  ownerAddress: Address; // manager or rewards, whichever has extended perms
  curveId: string; // bigint serialized
  operatorType: string; // CSM_DEF|CSM_LEA|CSM_ICS|CM_PO|CM_PTO|CM_PGO|CM_DO|CM_MODC|CM_IODC|CC
};

export type OperatorCacheEntry = {
  operators: CachedOperator[];
  lastFetchedAt: number; // Date.now()
};

export type SelectedAddress = {
  address: Address;
  source: AddressSource;
};

// Per-origin state — each site gets its own network/address
export type SiteState = {
  chainId: number;
  moduleType: ModuleType;
  selectedAddress: SelectedAddress | null;
  isConnected: boolean;
};

export const DEFAULT_SITE_STATE: SiteState = {
  chainId: 1,
  moduleType: 'csm',
  selectedAddress: null,
  isConnected: false,
};

// Shared settings across all sites
export type GlobalSettings = {
  customRpcUrls: Partial<Record<number, string>>;
  favorites: string[]; // scoped: "csm:1:42"
  manualAddresses: Address[];
  addressLabels: Record<string, string>; // lowercase address → label
  requireApproval: boolean;
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  customRpcUrls: {},
  favorites: [],
  manualAddresses: [],
  addressLabels: {},
  requireApproval: false,
};

// Composed view for popup — site state + global settings merged
export type WalletState = SiteState & GlobalSettings;

export const DEFAULT_WALLET_STATE: WalletState = {
  ...DEFAULT_SITE_STATE,
  ...DEFAULT_GLOBAL_SETTINGS,
};
