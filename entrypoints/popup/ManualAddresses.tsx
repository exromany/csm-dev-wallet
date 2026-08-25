import React, { useState } from 'react';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress } from '../../lib/popup/hooks.js';
import { LabelEditor } from './LabelEditor.js';

type Props = {
  addresses: Address[];
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSetLabel: (address: string, label: string) => void;
  onAdd: (address: string) => void;
  onRemove: (address: string) => void;
  onSelect: (address: string) => void;
};

export function ManualAddresses({
  addresses,
  selectedAddress,
  addressLabels,
  onSetLabel,
  onAdd,
  onRemove,
  onSelect,
}: Props) {
  const [name, setName] = useState('');
  const [addr, setAddr] = useState('');
  const { copy, isCopied } = useCopyAddress();

  const valid = isAddress(addr.trim());

  const handleAdd = () => {
    const trimmed = addr.trim();
    if (!isAddress(trimmed)) return;
    onAdd(trimmed);
    if (name.trim()) onSetLabel(trimmed, name.trim());
    setName('');
    setAddr('');
  };

  return (
    <div className="panel">
      <div className="manual-form-sticky">
        <div className="section-label">Add address</div>
        <div className="manual-form">
          <input
            className="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <input
            className="addr-input"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="0x address…"
          />
          <button
            className="btn-add-icon hint hint-right"
            disabled={!valid}
            onClick={handleAdd}
            data-hint="Add address"
          >
            +
          </button>
        </div>
      </div>

      {addresses.length > 0 && <div className="section-label spaced">Saved</div>}
      {addresses.map((address) => {
        const selected = selectedAddress?.toLowerCase() === address.toLowerCase();
        const label = addressLabels[address.toLowerCase()] ?? '';
        const copied = isCopied(address);
        return (
          <div
            key={address}
            className={`manual-entry ${selected ? 'selected' : ''} ${label ? '' : 'no-name'}`}
            onClick={() => onSelect(address)}
          >
            <div className="body">
              <LabelEditor
                label={label}
                onSave={(l) => onSetLabel(address, l)}
                className="entry-label"
                placeholder="Name this address…"
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
            <button
              className="btn-copy danger hint hint-right"
              onClick={(e) => { e.stopPropagation(); onRemove(address); }}
              data-hint="Remove"
            >
              ×
            </button>
          </div>
        );
      })}

      {addresses.length === 0 && (
        <div className="empty-state">
          No manual addresses yet.
          <br />
          Add an address above to connect as it.
        </div>
      )}
    </div>
  );
}
