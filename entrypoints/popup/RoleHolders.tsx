import React from 'react';
import type { Address } from 'viem';
import type { ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
import type { CachedRole, RoleHolder } from '../../lib/shared/types.js';
import { truncateAddress, formatTimeAgo } from '../../lib/popup/utils.js';
import { CopyButton } from './CopyButton.js';

type Props = {
  roles: CachedRole[];
  loading: boolean;
  lastFetchedAt: number | null;
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSelect: (address: Address, role: ProtocolRole) => void;
  onRefresh: () => void;
};

type RowProps = {
  holder: RoleHolder;
  label: string;
  selected: boolean;
  onSelect: () => void;
};

function RoleRow({ holder: { address, isContract }, label, selected, onSelect }: RowProps) {
  return (
    <div
      className={`manual-entry ${selected ? 'selected' : ''} ${label ? '' : 'no-name'}`}
      onClick={onSelect}
    >
      <div className="body">
        {label && <div className="name">{label}</div>}
        <div className="addr">{truncateAddress(address)}</div>
      </div>
      {isContract !== undefined && <span className="role-pill kind">{isContract ? 'contract' : 'EOA'}</span>}
      <CopyButton address={address} />
    </div>
  );
}

export function RoleHolders({
  roles,
  loading,
  lastFetchedAt,
  selectedAddress,
  addressLabels,
  onSelect,
  onRefresh,
}: Props) {
  return (
    <div className="panel">
      <div className="filter-bar">
        <span className="spacer" />
        {lastFetchedAt && (
          <span className="staleness-label">updated {formatTimeAgo(lastFetchedAt)}</span>
        )}
        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'loading…' : '↻ refresh'}
        </button>
      </div>

      {loading && roles.length === 0 ? (
        <div className="loading">
          <div className="spinner" />
          <p>Loading role holders…</p>
        </div>
      ) : roles.length === 0 ? (
        <div className="empty-state">No protocol roles for this module on this network.</div>
      ) : (
        roles.map(({ role, holders, error }) => (
          <details key={role} className="role-group" open>
            <summary>
              <span className="role-name">{role}</span>
              <span className="role-count">{holders.length}</span>
            </summary>
            {error ? (
              <div className="role-note error hint" data-hint={error}>⚠ failed to load</div>
            ) : holders.length === 0 ? (
              <div className="role-note">no holders</div>
            ) : (
              holders.map((holder) => (
                <RoleRow
                  key={holder.address}
                  holder={holder}
                  label={addressLabels[holder.address.toLowerCase()] ?? ''}
                  selected={selectedAddress?.toLowerCase() === holder.address.toLowerCase()}
                  onSelect={() => onSelect(holder.address, role)}
                />
              ))
            )}
          </details>
        ))
      )}
    </div>
  );
}
