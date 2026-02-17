import React from 'react';
import { CHAIN_ID, ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';

type Props = {
  chainId: number;
  onSwitch: (chainId: number) => void;
};

const NETWORKS = [
  { id: CHAIN_ID.Mainnet, name: 'Mainnet' },
  { id: CHAIN_ID.Hoodi, name: 'Hoodi' },
  { id: ANVIL_CHAIN_ID, name: 'Anvil' },
];

export function NetworkSelector({ chainId, onSwitch }: Props) {
  return (
    <select
      className="network-select"
      value={chainId}
      onChange={(e) => onSwitch(Number(e.target.value))}
    >
      {NETWORKS.map((n) => (
        <option key={n.id} value={n.id}>
          {n.name}
        </option>
      ))}
    </select>
  );
}
