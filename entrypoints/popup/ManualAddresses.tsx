import React, { useState } from 'react';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress } from '../../lib/popup/hooks.js';
import { AddressLabel } from './AddressLabel.js';

type Props = {
  addresses: Address[];
  anvilAccounts?: Address[];
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSetLabel: (address: string, label: string) => void;
  onAdd: (address: string) => void;
  onRemove: (address: string) => void;
  onSelect: (address: string) => void;
  onSelectAnvil?: (address: string, index: number) => void;
};

export function ManualAddresses({
  addresses,
  anvilAccounts = [],
  selectedAddress,
  addressLabels,
  onSetLabel,
  onAdd,
  onRemove,
  onSelect,
  onSelectAnvil,
}: Props) {
  const [input, setInput] = useState('');
  const { copy, isCopied } = useCopyAddress();

  const handleAdd = () => {
    const trimmed = input.trim();
    if (isAddress(trimmed)) {
      onAdd(trimmed);
      setInput('');
    }
  };

  return (
    <>
      {anvilAccounts.length > 0 && (
        <>
          <h4 className="section-label">Anvil Accounts (pre-funded)</h4>
          {anvilAccounts.map((addr, i) => {
            const selected =
              selectedAddress?.toLowerCase() === addr.toLowerCase();
            return (
              <div key={addr} className="operator-row">
                <div
                  className={`address-row ${selected ? 'selected' : ''}`}
                  onClick={() => onSelectAnvil?.(addr, i)}
                >
                  <span className="role-badge anvil">#{i}</span>
                  <span className="address-mono">{truncateAddress(addr)}</span>
                  <AddressLabel
                    address={addr}
                    label={addressLabels[addr.toLowerCase()] ?? ''}
                    onSave={(label) => onSetLabel(addr, label)}
                  />
                  <button
                    className="btn-copy"
                    onClick={(e) => { e.stopPropagation(); copy(addr); }}
                    title="Copy address"
                  >
                    {isCopied(addr) ? 'Copied!' : '\u2398'}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      <h4 className="section-label">Manual Addresses</h4>
      <div className="manual-input-row">
        <input
          placeholder="0x address..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn-add" onClick={handleAdd}>
          Add
        </button>
      </div>

      {addresses.length === 0 && (
        <div className="empty-state">
          No manual addresses yet.
          <br />
          Add an address above to connect as it.
        </div>
      )}

      {addresses.map((addr) => {
        const selected =
          selectedAddress?.toLowerCase() === addr.toLowerCase();
        return (
          <div key={addr} className="operator-row">
            <div
              className={`address-row ${selected ? 'selected' : ''}`}
              onClick={() => onSelect(addr)}
            >
              <span className="address-mono">{truncateAddress(addr)}</span>
              <AddressLabel
                address={addr}
                label={addressLabels[addr.toLowerCase()] ?? ''}
                onSave={(label) => onSetLabel(addr, label)}
              />
              <button
                className="btn-copy"
                onClick={(e) => { e.stopPropagation(); copy(addr); }}
                title="Copy address"
              >
                {isCopied(addr) ? 'Copied!' : '\u2398'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '2px 6px' }}>
              <button
                className="btn-disconnect"
                style={{ fontSize: 11 }}
                onClick={() => onRemove(addr)}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
