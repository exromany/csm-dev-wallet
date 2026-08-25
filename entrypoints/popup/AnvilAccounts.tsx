import React from 'react';
import type { Address } from 'viem';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress } from '../../lib/popup/hooks.js';
import { LabelEditor } from './LabelEditor.js';

type Props = {
  accounts: Address[];
  forkedFrom: number | null;
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSetLabel: (address: string, label: string) => void;
  onSelect: (address: string, index: number) => void;
};

export function AnvilAccounts({
  accounts,
  forkedFrom,
  selectedAddress,
  addressLabels,
  onSetLabel,
  onSelect,
}: Props) {
  const { copy, isCopied } = useCopyAddress();

  if (accounts.length === 0) {
    return (
      <div className="panel">
        <div className="empty-state">
          {forkedFrom == null ? (
            <>
              Anvil not detected.
              <br />
              Start a local fork to use pre-funded accounts.
            </>
          ) : (
            <>No pre-funded accounts reported by the fork.</>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="section-label">Anvil accounts (pre-funded)</div>
      {accounts.map((address, i) => {
        const selected = selectedAddress?.toLowerCase() === address.toLowerCase();
        const label = addressLabels[address.toLowerCase()] ?? '';
        const copied = isCopied(address);
        return (
          <div
            key={address}
            className={`manual-entry ${selected ? 'selected' : ''} ${label ? '' : 'no-name'}`}
            onClick={() => onSelect(address, i)}
          >
            <span className="anvil-index">#{i}</span>
            <div className="body">
              <LabelEditor
                label={label}
                onSave={(l) => onSetLabel(address, l)}
                className="entry-label"
                placeholder="Name this account…"
              />
              <div className="addr">{truncateAddress(address)}</div>
            </div>
            <button
              className={`btn-copy hint hint-right ${copied ? 'copied' : ''}`}
              onClick={(e) => { e.stopPropagation(); copy(address); }}
              data-hint={copied ? 'Copied' : 'Copy address'}
            >
              {copied ? '✓' : '⎘'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
