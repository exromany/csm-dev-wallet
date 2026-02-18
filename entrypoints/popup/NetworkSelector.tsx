import React from 'react';
import { CHAIN_ID, ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';

type Props = {
  chainId: number;
  forkedFrom?: number | null;
  onSwitch: (chainId: number) => void;
};

const NETWORKS = [
  { id: CHAIN_ID.Mainnet, label: 'Mainnet' },
  { id: CHAIN_ID.Hoodi, label: 'Hoodi' },
  { id: ANVIL_CHAIN_ID, label: 'Anvil' },
];

function getLabel(id: number, forkedFrom?: number | null): string {
  if (id !== ANVIL_CHAIN_ID || !forkedFrom) {
    return NETWORKS.find((n) => n.id === id)?.label ?? String(id);
  }
  const source = forkedFrom === CHAIN_ID.Mainnet ? 'Mainnet' : 'Hoodi';
  return `Anvil (${source})`;
}

export function NetworkSelector({ chainId, forkedFrom, onSwitch }: Props) {
  return (
    <select
      className="network-select"
      value={chainId}
      onChange={(e) => onSwitch(Number(e.target.value))}
    >
      {NETWORKS.map((n) => (
        <option
          key={n.id}
          value={n.id}
          disabled={n.id === ANVIL_CHAIN_ID && !forkedFrom && chainId !== ANVIL_CHAIN_ID}
        >
          {getLabel(n.id, forkedFrom)}
        </option>
      ))}
    </select>
  );
}
