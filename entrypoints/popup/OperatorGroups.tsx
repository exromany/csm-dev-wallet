import React, { useMemo, useState } from 'react';
import type { CachedOperator, AddressRole } from '../../lib/shared/types.js';
import {
  groupOperators,
  groupLabel,
  type OperatorGroup,
} from '../../lib/shared/groups.js';
import { filterGroupedView, type FilterGroup } from '../../lib/popup/hooks.js';
import { OperatorRow } from './OperatorList.js';

type Props = {
  operators: CachedOperator[];
  allOperatorsCount: number;
  loading: boolean;
  scope: FilterGroup;
  selectedAddress?: string;
  favorites: {
    toggle: (id: string) => void;
    isFavorite: (id: string) => boolean;
  };
  groupFavorites: {
    toggle: (id: string) => void;
    isFavorite: (id: string) => boolean;
  };
  operatorLabels: {
    get: (operatorId: string) => string;
    set: (operatorId: string, label: string) => void;
  };
  onSelect: (address: string, operatorId: string, role: AddressRole) => void;
};

export function OperatorGroups({
  operators,
  allOperatorsCount,
  loading,
  scope,
  selectedAddress,
  favorites,
  groupFavorites,
  operatorLabels,
  onSelect,
}: Props) {
  const grouped = useMemo(() => groupOperators(operators), [operators]);
  const filtered = useMemo(
    () => filterGroupedView(grouped, scope, groupFavorites.isFavorite),
    [grouped, scope, groupFavorites.isFavorite],
  );

  // In a filtered scope, groups auto-expand so matches are visible at once.
  const autoExpand = scope !== 'all';
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggleOpen = (id: string) =>
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  if (loading && operators.length === 0) {
    return (
      <div className="loading">
        <div className="spinner" />
        <p>Loading operators...</p>
      </div>
    );
  }

  if (filtered.groups.length === 0 && filtered.ungrouped.length === 0) {
    if (scope === 'favorites') {
      return (
        <div className="empty-state-rich">
          <div className="empty-glyph">☆</div>
          <div className="empty-headline">No favourites yet</div>
          <div className="empty-hint">Star a group header to pin it here.</div>
        </div>
      );
    }
    if (scope === 'pending') {
      return (
        <div className="empty-state-rich">
          <div className="empty-glyph">✓</div>
          <div className="empty-headline">No pending changes</div>
          <div className="empty-hint">Address transitions in progress will show up here.</div>
        </div>
      );
    }
    const message =
      allOperatorsCount > 0 ? 'No matching operators' : 'No operators found';
    return <div className="empty-state">{message}</div>;
  }

  return (
    <div className="operator-groups">
      {filtered.groups.map(({ group, partial }) => {
        const isOpen = autoExpand || openIds.has(group.id);
        const starred = groupFavorites.isFavorite(group.id);
        const totalCount = grouped.groups.find((g) => g.id === group.id)?.operators.length ?? group.operators.length;
        return (
          <GroupSection
            key={group.id}
            group={group}
            isOpen={isOpen}
            onToggleOpen={() => toggleOpen(group.id)}
            starred={starred}
            onToggleStar={() => groupFavorites.toggle(group.id)}
            partial={partial}
            shownCount={group.operators.length}
            totalCount={totalCount}
            selectedAddress={selectedAddress}
            favorites={favorites}
            operatorLabels={operatorLabels}
            onSelect={onSelect}
          />
        );
      })}
      {filtered.ungrouped.length > 0 && (
        <UngroupedSection
          operators={filtered.ungrouped}
          selectedAddress={selectedAddress}
          favorites={favorites}
          operatorLabels={operatorLabels}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function GroupSection({
  group,
  isOpen,
  onToggleOpen,
  starred,
  onToggleStar,
  partial,
  shownCount,
  totalCount,
  selectedAddress,
  favorites,
  operatorLabels,
  onSelect,
}: {
  group: OperatorGroup;
  isOpen: boolean;
  onToggleOpen: () => void;
  starred: boolean;
  onToggleStar: () => void;
  partial: boolean;
  shownCount: number;
  totalCount: number;
  selectedAddress?: string;
  favorites: Props['favorites'];
  operatorLabels: Props['operatorLabels'];
  onSelect: Props['onSelect'];
}) {
  return (
    <div className={`group-section ${isOpen ? 'open' : ''}`}>
      <button
        className="group-header"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
      >
        <span className={`group-caret ${isOpen ? 'open' : ''}`} aria-hidden>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 2L7 5L3.5 8" />
          </svg>
        </span>
        <button
          className={`group-star ${starred ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleStar(); }}
          title={starred ? 'Unfavourite group' : 'Favourite this group'}
        >
          {starred ? '★' : '☆'}
        </button>
        <span className="group-title">{groupLabel(group)}</span>
        {group.name && <span className="group-id-tag">g·{group.id}</span>}
        <div className="spacer" />
        {partial && (
          <span className="group-partial-hint" title="Only matching operators shown">
            {shownCount} of {totalCount}
          </span>
        )}
        <span className="group-count">
          {shownCount} op{shownCount === 1 ? '' : 's'}
        </span>
      </button>
      {isOpen && (
        <div className="group-body">
          {group.operators.map((op) => (
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
      )}
    </div>
  );
}

function UngroupedSection({
  operators,
  selectedAddress,
  favorites,
  operatorLabels,
  onSelect,
}: {
  operators: CachedOperator[];
  selectedAddress?: string;
  favorites: Props['favorites'];
  operatorLabels: Props['operatorLabels'];
  onSelect: Props['onSelect'];
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`ungrouped-section ${open ? 'open' : ''}`}>
      <button
        className="ungrouped-header"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`group-caret ${open ? 'open' : ''}`} aria-hidden>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 2L7 5L3.5 8" />
          </svg>
        </span>
        <span className="ungrouped-label">No group</span>
        <div className="spacer" />
        <span className="group-count">
          {operators.length} op{operators.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="ungrouped-body">
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
      )}
    </div>
  );
}
