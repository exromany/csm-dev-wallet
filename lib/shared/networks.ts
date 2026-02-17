import type { Chain } from 'viem';
import { mainnet, hoodi } from 'viem/chains';

/** Lido chain IDs (mirrors @lidofinance/lido-ethereum-sdk CHAINS enum) */
export const CHAIN_ID = {
  Mainnet: 1,
  Hoodi: 560048,
} as const;

export type SupportedChainId = (typeof CHAIN_ID)[keyof typeof CHAIN_ID];

export const SUPPORTED_CHAIN_IDS: SupportedChainId[] = [
  CHAIN_ID.Mainnet,
  CHAIN_ID.Hoodi,
];

export const ANVIL_CHAIN_ID = 31337;

export type NetworkConfig = {
  chainId: number;
  name: string;
  rpcUrl: string;
  viemChain: Chain;
  isAnvil?: boolean;
  forkedFrom?: SupportedChainId;
};

export const DEFAULT_NETWORKS: Record<SupportedChainId, NetworkConfig> = {
  [CHAIN_ID.Mainnet]: {
    chainId: CHAIN_ID.Mainnet,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth.drpc.org',
    viemChain: mainnet,
  },
  [CHAIN_ID.Hoodi]: {
    chainId: CHAIN_ID.Hoodi,
    name: 'Hoodi Testnet',
    rpcUrl: 'https://ethereum-hoodi-rpc.publicnode.com',
    viemChain: hoodi,
  },
};

export const ANVIL_NETWORK: NetworkConfig = {
  chainId: ANVIL_CHAIN_ID,
  name: 'Anvil (Local)',
  rpcUrl: 'http://127.0.0.1:8545',
  viemChain: mainnet, // overridden when fork source detected
  isAnvil: true,
};
