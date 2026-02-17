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
  const isOwnerManager = op.extendedManagerPermissions;

  const addresses: { role: AddressRole; label: string; address: string; isOwner: boolean }[] = [
    {
      role: 'manager',
      label: 'MGR',
      address: op.managerAddress,
      isOwner: isOwnerManager,
    },
    {
      role: 'rewards',
      label: 'RWD',
      address: op.rewardsAddress,
      isOwner: !isOwnerManager,
    },
  ];

  if (op.proposedManagerAddress) {
    addresses.push({
      role: 'proposedManager',
      label: 'P-MGR',
      address: op.proposedManagerAddress,
      isOwner: false,
    });
  }
  if (op.proposedRewardsAddress) {
    addresses.push({
      role: 'proposedRewards',
      label: 'P-RWD',
      address: op.proposedRewardsAddress,
      isOwner: false,
    });
  }

  return (
    <div className="operator-row">
      <div className="operator-header">
        <span className="operator-id">#{op.id}</span>
        <span className="operator-type">{op.operatorType}</span>
        <button
          className={`btn-star ${isFavorite ? 'active' : ''}`}
          onClick={onToggleFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFavorite ? '\u2605' : '\u2606'}
        </button>
      </div>

      {addresses.map(({ role, label, address, isOwner }) => {
        const selected =
          selectedAddress?.toLowerCase() === address.toLowerCase();
        return (
          <div
            key={role}
            className={`address-row ${selected ? 'selected' : ''}`}
            onClick={() => onSelect(address, op.id, role)}
          >
            <span className={`role-badge ${role === 'manager' ? 'manager' : role === 'rewards' ? 'rewards' : 'proposed'}`}>
              {label}
            </span>
            {isOwner && <span className="role-badge owner">owner</span>}
            <span className="address-mono">{truncateAddress(address)}</span>
          </div>
        );
      })}
    </div>
  );
}
