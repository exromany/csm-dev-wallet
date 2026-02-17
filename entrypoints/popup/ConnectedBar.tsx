import React from 'react';
import type { SelectedAddress } from '../../lib/shared/types.js';
import { truncateAddress } from '../../lib/popup/utils.js';

type Props = {
  address: SelectedAddress;
  onDisconnect: () => void;
};

export function ConnectedBar({ address, onDisconnect }: Props) {
  return (
    <div className="connected-bar">
      <span className="address">{truncateAddress(address.address)}</span>
      <span className="badge watch">watch-only</span>
      <button className="btn-disconnect" onClick={onDisconnect}>
        Disconnect
      </button>
    </div>
  );
}
