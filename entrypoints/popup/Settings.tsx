import React, { useState, useEffect } from 'react';
import type { WalletState } from '../../lib/shared/types.js';
import { CHAIN_ID, DEFAULT_NETWORKS, ANVIL_NETWORK } from '../../lib/shared/networks.js';

type Props = {
  state: WalletState;
  onSetRpc: (chainId: number, rpcUrl: string) => void;
};

const CONFIGURABLE_NETWORKS = [
  { chainId: CHAIN_ID.Mainnet, label: 'Mainnet RPC', defaultUrl: DEFAULT_NETWORKS[CHAIN_ID.Mainnet].rpcUrl },
  { chainId: CHAIN_ID.Hoodi, label: 'Hoodi RPC', defaultUrl: DEFAULT_NETWORKS[CHAIN_ID.Hoodi].rpcUrl },
  { chainId: ANVIL_NETWORK.chainId, label: 'Anvil RPC', defaultUrl: ANVIL_NETWORK.rpcUrl },
];

export function Settings({ state, onSetRpc }: Props) {
  return (
    <>
      <h3 style={{ marginBottom: 12, fontSize: 13 }}>RPC Endpoints</h3>
      {CONFIGURABLE_NETWORKS.map(({ chainId, label, defaultUrl }) => (
        <RpcInput
          key={chainId}
          label={label}
          defaultUrl={defaultUrl}
          currentUrl={
            (state.customRpcUrls as Record<number, string>)[chainId] ?? ''
          }
          onSave={(url) => onSetRpc(chainId, url)}
        />
      ))}
    </>
  );
}

function RpcInput({
  label,
  defaultUrl,
  currentUrl,
  onSave,
}: {
  label: string;
  defaultUrl: string;
  currentUrl: string;
  onSave: (url: string) => void;
}) {
  const [value, setValue] = useState(currentUrl);

  useEffect(() => {
    setValue(currentUrl);
  }, [currentUrl]);

  return (
    <div className="settings-group">
      <label>{label}</label>
      <input
        placeholder={defaultUrl}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value !== currentUrl) onSave(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value !== currentUrl) onSave(value);
        }}
      />
    </div>
  );
}
