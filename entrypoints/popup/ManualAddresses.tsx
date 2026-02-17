import React, { useState } from 'react';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import { truncateAddress } from '../../lib/popup/utils.js';

type Props = {
  addresses: Address[];
  selectedAddress?: string;
  onAdd: (address: string) => void;
  onRemove: (address: string) => void;
  onSelect: (address: string) => void;
};

export function ManualAddresses({
  addresses,
  selectedAddress,
  onAdd,
  onRemove,
  onSelect,
}: Props) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const trimmed = input.trim();
    if (isAddress(trimmed)) {
      onAdd(trimmed);
      setInput('');
    }
  };

  return (
    <>
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
