import React from 'react';
import type { SelectedAddress } from '../../lib/shared/types.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress } from '../../lib/popup/hooks.js';

type Props = {
  address: SelectedAddress;
  chainId: number;
  label?: string;
  onDisconnect: () => void;
};

export function ConnectedBar({ address, chainId, label, onDisconnect }: Props) {
  const isAnvil = chainId === ANVIL_CHAIN_ID;
  const { copy, isCopied } = useCopyAddress();
  return (
    <div className="connected-bar">
      <span className="address">{truncateAddress(address.address)}</span>
      {label && <span className="address-label">{label}</span>}
      <button
        className="btn-copy"
        onClick={() => copy(address.address)}
        title="Copy address"
      >
        {isCopied(address.address) ? 'Copied!' : '\u2398'}
      </button>
      <span className={`badge ${isAnvil ? 'anvil' : 'watch'}`}>
        {isAnvil ? 'anvil' : 'watch-only'}
      </span>
      <button className="btn-disconnect" onClick={onDisconnect}>
        Disconnect
      </button>
    </div>
  );
}
