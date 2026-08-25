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
  const copied = isCopied(address.address);

  return (
    <div className="connected-pill">
      <span className="dot" />
      <span className="address mono">{truncateAddress(address.address)}</span>
      {label && <span className="label">{label}</span>}
      <span className={`badge ${isAnvil ? 'anvil' : 'watch'}`}>
        {isAnvil ? 'anvil' : 'watch-only'}
      </span>
      <div className="spacer" />
      <button
        className={`btn-copy hint ${copied ? 'copied' : ''}`}
        onClick={() => copy(address.address)}
        data-hint={copied ? 'Copied' : 'Copy address'}
      >
        {copied ? '✓' : '⎘'}
      </button>
      <button className="btn-ghost danger" onClick={onDisconnect}>
        disconnect
      </button>
    </div>
  );
}
