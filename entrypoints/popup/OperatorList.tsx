import React from 'react';
import type { CachedOperator, AddressRole } from '../../lib/shared/types.js';
import {
  roleEntries,
  operatorKind,
  roleHintByLabel,
  operatorTypeHint,
  type RoleLabel,
} from '../../lib/shared/attachments.js';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress } from '../../lib/popup/hooks.js';
import { LabelEditor } from './LabelEditor.js';
import { IconCheck, IconCopy, IconStar } from './icons.js';

type Props = {
  operators: CachedOperator[];
  allOperatorsCount: number;
  loading: boolean;
  selectedAddress?: string;
  favorites: {
    toggle: (id: string) => void;
    isFavorite: (id: string) => boolean;
  };
  operatorLabels: {
    get: (operatorId: string) => string;
    set: (operatorId: string, label: string) => void;
  };
  onSelect: (address: string, operatorId: string, role: AddressRole) => void;
};

export function OperatorList({
  operators,
  allOperatorsCount,
  loading,
  selectedAddress,
  favorites,
  operatorLabels,
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
    const message = allOperatorsCount > 0 ? 'No matching operators' : 'No operators found';
    return <div className="empty-state">{message}</div>;
  }

  return (
    <div className="operator-list">
      {operators.map((op) => (
        <OperatorRow
          key={op.id}
          operator={op}
          selectedAddress={selectedAddress}
          isFavorite={favorites.isFavorite(op.id)}
          onToggleFavorite={() => favorites.toggle(op.id)}
          label={operatorLabels.get(op.id)}
          onLabel={(label) => operatorLabels.set(op.id, label)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function OperatorRow({
  operator: op,
  selectedAddress,
  isFavorite,
  onToggleFavorite,
  label,
  onLabel,
  onSelect,
}: {
  operator: CachedOperator;
  selectedAddress?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  label: string;
  onLabel: (label: string) => void;
  onSelect: (address: string, operatorId: string, role: AddressRole) => void;
}) {
  const groups = groupAddresses(op);
  const hasSelected = groups.some(
    (g) => selectedAddress?.toLowerCase() === g.address.toLowerCase(),
  );
  const kind = operatorKind(op.operatorType);
  const merged = groups.length === 1 && groups[0].proposedPills.length === 0;
  const firstRow = merged ? [groups[0]] : groups.slice(0, 2);
  const overflowRow = !merged && groups.length > 2 ? groups.slice(2) : [];

  return (
    <div className={`operator-row kind-${kind} ${hasSelected ? 'has-selected' : ''}`}>
      <div className="operator-ribbon" />
      <div className="operator-body">
        <div className="operator-header">
          <span className="operator-id">#{op.id}</span>
          {op.operatorType && (
            <span
              className="operator-type hint"
              data-hint={operatorTypeHint(op.operatorType, op.curveId)}
            >
              {op.operatorType.replace(/^CSM_|^CM_/, '')}
            </span>
          )}
          <LabelEditor
            label={label}
            onSave={onLabel}
            placeholder="Label this operator…"
          />
          <div className="spacer" />
          <button
            className={`btn-star hint hint-right ${isFavorite ? 'active' : ''}`}
            onClick={onToggleFavorite}
            data-hint={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <IconStar filled={isFavorite} />
          </button>
        </div>

        <div className="address-chips">
          {firstRow.map((g) => (
            <AddressChip
              key={g.address}
              group={g}
              operatorId={op.id}
              selectedAddress={selectedAddress}
              onSelect={onSelect}
            />
          ))}
        </div>
        {overflowRow.length > 0 && (
          <div className="address-chips">
            {overflowRow.map((g) => (
              <AddressChip
                key={g.address}
                group={g}
                operatorId={op.id}
                selectedAddress={selectedAddress}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type RolePill = { label: Exclude<RoleLabel, 'P-MGR' | 'P-RWD'>; tint: 'mgr' | 'rwd' | 'clm'; owner: boolean };

type AddressGroup = {
  address: string;
  primaryRole: AddressRole;
  rolePills: RolePill[];
  proposedPills: string[];
};

function groupAddresses(op: CachedOperator): AddressGroup[] {
  const map = new Map<string, AddressGroup>();
  for (const e of roleEntries(op)) {
    const key = e.address.toLowerCase();
    let group = map.get(key);
    if (!group) {
      group = { address: e.address, primaryRole: e.role, rolePills: [], proposedPills: [] };
      map.set(key, group);
    }
    if (e.proposed) {
      group.proposedPills.push(e.label);
    } else {
      group.rolePills.push({ label: e.label as RolePill['label'], tint: e.tint, owner: e.owner });
    }
  }
  return Array.from(map.values());
}

function AddressChip({
  group: g,
  operatorId,
  selectedAddress,
  onSelect,
}: {
  group: AddressGroup;
  operatorId: string;
  selectedAddress?: string;
  onSelect: (address: string, operatorId: string, role: AddressRole) => void;
}) {
  const selected = selectedAddress?.toLowerCase() === g.address.toLowerCase();
  const pendingOnly = g.rolePills.length === 0;
  const { copy, isCopied } = useCopyAddress();
  const copied = isCopied(g.address);

  return (
    <div
      className={`address-chip ${selected ? 'selected' : ''} ${pendingOnly ? 'pending-only' : ''}`}
      onClick={() => onSelect(g.address, operatorId, g.primaryRole)}
    >
      <div className="chip-pills">
        {g.rolePills.map((p) => (
          <span
            key={p.label}
            className={`role-pill hint tint-${p.tint} ${p.owner ? 'owner' : ''}`}
            data-hint={roleHintByLabel(p.label, p.owner)}
          >
            {p.label}
          </span>
        ))}
        {g.proposedPills.map((label) => (
          <span
            key={label}
            className="role-pill hint dashed"
            data-hint={roleHintByLabel(label as 'P-MGR' | 'P-RWD', false)}
          >
            {label}
          </span>
        ))}
      </div>
      <span className="chip-addr">{truncateAddress(g.address)}</span>
      <button
        className={`chip-copy hint hint-right ${copied ? 'copied' : ''}`}
        onClick={(e) => { e.stopPropagation(); copy(g.address); }}
        data-hint={copied ? 'Copied' : 'Copy address'}
        aria-label={copied ? 'Copied' : 'Copy address'}
      >
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}

