import React from 'react';
import type { CachedOperator, AddressRole } from '../../lib/shared/types.js';
import { truncateAddress } from '../../lib/popup/utils.js';

type Props = {
  operators: CachedOperator[];
  loading: boolean;
  selectedAddress?: string;
  favorites: {
    toggle: (id: string) => void;
    isFavorite: (id: string) => boolean;
  };
  onSelect: (address: string, operatorId: string, role: AddressRole) => void;
};

export function OperatorList({
  operators,
  loading,
  selectedAddress,
  favorites,
  onSelect,
}: Props) {
  if (loading && operators.length === 0) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading operators...</p>
      </div>
    );
  }

  if (operators.length === 0) {
    return <div className="empty-state">No operators found</div>;
  }

  return (
    <>
      {operators.map((op) => (
        <OperatorRow
          key={op.id}
          operator={op}
          selectedAddress={selectedAddress}
          isFavorite={favorites.isFavorite(op.id)}
          onToggleFavorite={() => favorites.toggle(op.id)}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

type AddressGroup = {
  address: string;
  roles: { role: AddressRole; label: string }[];
  isOwner: boolean;
};

function groupAddresses(op: CachedOperator): AddressGroup[] {
  const entries: { role: AddressRole; label: string; address: string; isOwner: boolean }[] = [
    { role: 'manager', label: 'MGR', address: op.managerAddress, isOwner: op.extendedManagerPermissions },
    { role: 'rewards', label: 'RWD', address: op.rewardsAddress, isOwner: !op.extendedManagerPermissions },
  ];
  if (op.proposedManagerAddress) {
    entries.push({ role: 'proposedManager', label: 'P-MGR', address: op.proposedManagerAddress, isOwner: false });
  }
  if (op.proposedRewardsAddress) {
    entries.push({ role: 'proposedRewards', label: 'P-RWD', address: op.proposedRewardsAddress, isOwner: false });
  }

  const grouped = new Map<string, AddressGroup>();
  for (const e of entries) {
    const key = e.address.toLowerCase();
    const existing = grouped.get(key);
    if (existing) {
      existing.roles.push({ role: e.role, label: e.label });
      existing.isOwner = existing.isOwner || e.isOwner;
    } else {
      grouped.set(key, {
        address: e.address,
        roles: [{ role: e.role, label: e.label }],
        isOwner: e.isOwner,
      });
    }
  }
  return Array.from(grouped.values());
}

function roleBadgeClass(role: AddressRole): string {
  if (role === 'manager') return 'manager';
  if (role === 'rewards') return 'rewards';
  return 'proposed';
}

function OperatorRow({
  operator: op,
  selectedAddress,
  isFavorite,
  onToggleFavorite,
  onSelect,
}: {
  operator: CachedOperator;
  selectedAddress?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onSelect: (address: string, operatorId: string, role: AddressRole) => void;
}) {
  const groups = groupAddresses(op);

  return (
    <div className="operator-row">
      <div className="operator-header">
        <span className="operator-id">#{op.id}</span>
        {op.operatorType && <span className="operator-type">{op.operatorType}</span>}
        <div className="spacer" />
        <button
          className={`btn-star ${isFavorite ? 'active' : ''}`}
          onClick={onToggleFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFavorite ? '\u2605' : '\u2606'}
        </button>
      </div>

      {groups.map((group) => {
        const selected = selectedAddress?.toLowerCase() === group.address.toLowerCase();
        return (
          <div
            key={group.address}
            className={`address-row ${selected ? 'selected' : ''}`}
            onClick={() => onSelect(group.address, op.id, group.roles[0].role)}
          >
            {group.roles.map(({ role, label }) => (
              <span key={role} className={`role-badge ${roleBadgeClass(role)}`}>
                {label}
              </span>
            ))}
            {group.isOwner && <span className="role-badge owner">owner</span>}
            <span className="address-mono">{truncateAddress(group.address)}</span>
          </div>
        );
      })}
    </div>
  );
}
