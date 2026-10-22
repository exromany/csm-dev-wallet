import React from 'react';
import type { Address } from 'viem';
import type { ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
import type { ModuleType, RoleHolder } from '../../lib/shared/types.js';
import { MODULE_SHORT } from '../../lib/shared/modules.js';
import { truncateAddress } from '../../lib/popup/utils.js';
import type { RoleGroup } from '../../lib/popup/hooks.js';
import { CopyButton } from './CopyButton.js';

type Props = {
  groups: RoleGroup[];
  loading: boolean;
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSelect: (address: Address, role: ProtocolRole, moduleType: ModuleType) => void;
  onRefresh: () => void;
};

type Entry = RoleGroup['entries'][number];

type RowProps = {
  holder: RoleHolder;
  tag: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
};

function RoleRow({ holder: { address, isContract }, tag, label, selected, onSelect }: RowProps) {
  return (
    <div
      className={`manual-entry ${selected ? 'selected' : ''} ${label ? '' : 'no-name'}`}
      onClick={onSelect}
    >
      <span className="role-pill tint-mgr">{tag}</span>
      <div className="body">
        {label && <div className="name">{label}</div>}
        <div className="addr">{truncateAddress(address)}</div>
      </div>
      {isContract !== undefined && <span className="role-pill kind">{isContract ? 'contract' : 'EOA'}</span>}
      <CopyButton address={address} />
    </div>
  );
}

type EntryProps = {
  role: ProtocolRole;
  entry: Entry;
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSelect: Props['onSelect'];
};

function ModuleEntry({ role, entry: { moduleType, holders, error }, selectedAddress, addressLabels, onSelect }: EntryProps) {
  const tag = MODULE_SHORT[moduleType];
  if (error) return <div className="role-note error hint" data-hint={error}>{tag} ⚠</div>;
  if (holders.length === 0) return <div className="role-note">{tag} — no holders</div>;
  return (
    <>
      {holders.map((holder) => (
        <RoleRow
          key={holder.address}
          holder={holder}
          tag={tag}
          label={addressLabels[holder.address.toLowerCase()] ?? ''}
          selected={selectedAddress?.toLowerCase() === holder.address.toLowerCase()}
          onSelect={() => onSelect(holder.address, role, moduleType)}
        />
      ))}
    </>
  );
}

export function RoleHolders({ groups, loading, selectedAddress, addressLabels, onSelect, onRefresh }: Props) {
  return (
    <div className="panel">
      <div className="filter-bar">
        <span className="spacer" />
        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'loading…' : '↻ refresh'}
        </button>
      </div>

      {loading && groups.length === 0 ? (
        <div className="loading">
          <div className="spinner" />
          <p>Loading role holders…</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">No protocol roles on this network.</div>
      ) : (
        groups.map(({ role, entries }) => (
          <details key={role} className="role-group" open>
            <summary>
              <span className="role-name">{role}</span>
              <span className="role-scope">{entries.map((e) => MODULE_SHORT[e.moduleType]).join(' · ')}</span>
              <span className="role-count">{entries.reduce((n, e) => n + e.holders.length, 0)}</span>
            </summary>
            {entries.map((entry) => (
              <ModuleEntry
                key={entry.moduleType}
                role={role}
                entry={entry}
                selectedAddress={selectedAddress}
                addressLabels={addressLabels}
                onSelect={onSelect}
              />
            ))}
          </details>
        ))
      )}
    </div>
  );
}
