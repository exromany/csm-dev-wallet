import type { Address } from 'viem';

export type ModuleType = 'csm' | 'cm';

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
  operatorType: string; // CSM: DEF|LEA|ICS|CC, CM: PTO|PO|PGO|DO|EEO|MODC|IODC|CC
};

export type OperatorCacheEntry = {
  operators: CachedOperator[];
  lastFetchedAt: number; // Date.now()
};

export type SelectedAddress = {
  address: Address;
  source: AddressSource;
};

export type WalletState = {
  chainId: number;
  moduleType: ModuleType;
  selectedAddress: SelectedAddress | null;
  isConnected: boolean;
  customRpcUrls: Partial<Record<number, string>>;
  favorites: string[]; // scoped: "csm:1:42"
  manualAddresses: Address[];
};

export const DEFAULT_WALLET_STATE: WalletState = {
  chainId: 1,
  moduleType: 'csm',
  selectedAddress: null,
  isConnected: false,
  customRpcUrls: {},
  favorites: [],
  manualAddresses: [],
};
