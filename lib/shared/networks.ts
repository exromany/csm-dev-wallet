import { CHAINS } from '@lidofinance/lido-ethereum-sdk';
import type { Chain } from 'viem';
import { mainnet, hoodi } from 'viem/chains';

export type SupportedChainId = typeof CHAINS.Mainnet | typeof CHAINS.Hoodi;

export const SUPPORTED_CHAIN_IDS: SupportedChainId[] = [
  CHAINS.Mainnet,
  CHAINS.Hoodi,
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
  [CHAINS.Mainnet]: {
    chainId: CHAINS.Mainnet,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth.drpc.org',
    viemChain: mainnet,
  },
  [CHAINS.Hoodi]: {
    chainId: CHAINS.Hoodi,
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
