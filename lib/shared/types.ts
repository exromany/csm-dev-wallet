import type { Address } from 'viem';
import type { ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
import type { SupportedChainId } from './networks.js';

export type ModuleType = 'csm' | 'cm' | 'csm02';

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
  | 'proposedRewards'
  | 'claimer';

export type AddressSource =
  | { type: 'operator'; operatorId: string; role: AddressRole }
  | { type: 'gate'; gate: string }
  | { type: 'role'; role: ProtocolRole }
  | { type: 'anvil'; index: number }
  | { type: 'manual' };

export type FeeSplit = {
  recipient: Address;
  share: string; // bigint serialized — basis points of MAX_BP = 10_000
};

export type CachedOperator = {
  id: string; // bigint serialized — chrome.storage can't hold bigints
  managerAddress: Address;
  rewardsAddress: Address;
  proposedManagerAddress?: Address;
  proposedRewardsAddress?: Address;
  claimerAddress?: Address;
  extendedManagerPermissions: boolean; // true → manager is the owner, false → rewards is
  curveId: string; // bigint serialized
  operatorType: string; // OPERATOR_TYPE from @lidofinance/lido-csm-sdk — scoped to moduleType, falls back to "CC"
  // CM-only: MetaRegistry group membership. Absent for CSM operators and
  // for CM operators that belong to no group.
  groupId?: string; // bigint serialized
  groupName?: string; // optional on-chain title
  // Accounting v3 getFeeSplits — set only when non-empty; absent = none or unknown.
  feeSplits?: FeeSplit[];
  // CM-only: CuratedModule v2 isTopUpAllocationEnabled === false. Absent = enabled or unknown.
  topUpDisabled?: true;
};

export type OperatorCacheEntry = {
  operators: CachedOperator[];
  lastFetchedAt: number; // Date.now()
};

/** A gate's unconsumed tree leaves. `error` set → the gate couldn't be read; its lists are empty. */
export type CachedGate = {
  gate: string; // SDK contract name: 'icsGate', 'curatedGatePTO'
  label: string; // 'ICS', 'PTO'
  curveId: string; // bigint serialized
  operatorType: string; // the type an operator joining through this gate gets, 'CC' if unknown
  paused: boolean;
  unconsumed: Address[];
  leafCount: number;
  error?: string;
};

export type GateCacheEntry = {
  gates: CachedGate[];
  lastFetchedAt: number;
};

export type RoleHolder = { address: Address; isContract?: boolean };

/** `error` set → the role couldn't be read; `holders` is empty. */
export type CachedRole = { role: ProtocolRole; holders: RoleHolder[]; error?: string };

export type RoleCacheEntry = { roles: CachedRole[]; lastFetchedAt: number };

export type SelectedAddress = {
  address: Address;
  source: AddressSource;
};

// Persistable popup tabs. Settings is deliberately excluded — it's a transient
// destination we never want to land on when the popup reopens.
export type PopupTab = 'operators' | 'groups' | 'shared' | 'manual' | 'roles' | 'anvil';

// Per-origin state — each site gets its own network/address/view
export type SiteState = {
  chainId: number;
  moduleType: ModuleType;
  selectedAddress: SelectedAddress | null;
  isConnected: boolean;
  activeTab: PopupTab; // last opened tab, restored on reopen (Settings never persists)
};

export const DEFAULT_SITE_STATE: SiteState = {
  chainId: 1,
  moduleType: 'csm',
  selectedAddress: null,
  isConnected: false,
  activeTab: 'operators',
};

// Shared settings across all sites
export type GlobalSettings = {
  customRpcUrls: Partial<Record<number, string>>;
  favorites: string[]; // scoped: "csm:1:42"
  groupFavorites: string[]; // scoped: "cm:1:3" — module:chainId:groupId
  manualAddresses: Address[];
  addressLabels: Record<string, string>; // lowercase address → label
  operatorLabels: Record<string, string>; // scoped "csm:1:42" → label
  requireApproval: boolean;
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  customRpcUrls: {},
  favorites: [],
  groupFavorites: [],
  manualAddresses: [],
  addressLabels: {},
  operatorLabels: {},
  requireApproval: false,
};

// Composed view for popup — site state + global settings merged
export type WalletState = SiteState & GlobalSettings;

export const DEFAULT_WALLET_STATE: WalletState = {
  ...DEFAULT_SITE_STATE,
  ...DEFAULT_GLOBAL_SETTINGS,
};
