import React from 'react';
import type { SelectedAddress } from '../../lib/shared/types.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { truncateAddress } from '../../lib/popup/utils.js';

type Props = {
  address: SelectedAddress;
  chainId: number;
  onDisconnect: () => void;
};

export function ConnectedBar({ address, chainId, onDisconnect }: Props) {
  const isAnvil = chainId === ANVIL_CHAIN_ID;
  return (
    <div className="connected-bar">
      <span className="address">{truncateAddress(address.address)}</span>
      <span className={`badge ${isAnvil ? 'anvil' : 'watch'}`}>
        {isAnvil ? 'anvil' : 'watch-only'}
      </span>
      <button className="btn-disconnect" onClick={onDisconnect}>
        Disconnect
      </button>
    </div>
  );
}
