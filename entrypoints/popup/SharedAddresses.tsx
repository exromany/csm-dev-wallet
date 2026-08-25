import React, { useMemo, useState } from 'react';
import type { AddressRole, ModuleType } from '../../lib/shared/types.js';
import { countLabel, type AddressAttachments, type Attachment } from '../../lib/shared/attachments.js';
import { truncateAddress, formatTimeAgo } from '../../lib/popup/utils.js';
import { useCopyAddress, filterSharedAddresses, type SharedFilter } from '../../lib/popup/hooks.js';

type Props = {
  addresses: AddressAttachments[];
  loading: boolean;
  lastFetchedAt: number | null;
  cmMissing: boolean;
  addressLabels: Record<string, string>;
  selectedAddress?: string;
  selectedOperatorId?: string;
  siteModuleType: ModuleType;
  onRefresh: () => void;
  onSelect: (
    address: string,
    operatorId: string,
    role: AddressRole,
    moduleType: ModuleType,
  ) => void;
};

export function SharedAddresses({
  addresses,
  loading,
  lastFetchedAt,
  cmMissing,
  addressLabels,
  selectedAddress,
  selectedOperatorId,
  siteModuleType,
  onRefresh,
  onSelect,
}: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SharedFilter>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const shown = useMemo(
    () => filterSharedAddresses(addresses, search, filter, addressLabels),
    [addresses, search, filter, addressLabels],
  );

  return (
    <>
      <div className="search-wrapper">
        <div className="search-row">
          <div className="search-bar">
            <span className="search-icon">⌕</span>
            <input
              placeholder="Search address, label, #ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}>×</button>
            )}
          </div>
        </div>
        <div className="filter-bar">
          {(
            [
              ['all', 'All'],
              ['cross', 'Cross-module'],
              ['pending', 'Pending'],
            ] satisfies ReadonlyArray<readonly [SharedFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              className={`filter-btn ${filter === value ? 'active' : ''}`}
              onClick={() => setFilter(value)}
              title={
                value === 'pending'
                  ? 'Addresses caught up in a proposed role change'
                  : undefined
              }
            >
              {label}
            </button>
          ))}
          <div className="spacer" />
          {lastFetchedAt && (
            <span className="staleness-label">updated {formatTimeAgo(lastFetchedAt)}</span>
          )}
          <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
            {loading ? 'loading…' : '↻ refresh'}
          </button>
        </div>
      </div>

      {cmMissing && (
        <div className="scope-note">CM is not deployed on this network — showing CSM only.</div>
      )}

      {loading ? (
        <div className="loading">
          <div className="spinner" />
          <p>Loading operators...</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state-rich">
          <div className="empty-glyph">⇉</div>
          <div className="empty-headline">No shared addresses</div>
          <div className="empty-hint">
            Addresses attached to more than one operator show up here.
          </div>
        </div>
      ) : (
        <div className="addr-list">
          {shown.map((entry) => {
            const key = entry.address.toLowerCase();
            return (
              <AddressCard
                key={key}
                entry={entry}
                label={addressLabels[key] ?? ''}
                open={openKey === key}
                onToggle={() => setOpenKey(openKey === key ? null : key)}
                selectedAddress={selectedAddress}
                selectedOperatorId={selectedOperatorId}
                siteModuleType={siteModuleType}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function AddressCard({
  entry,
  label,
  open,
  onToggle,
  selectedAddress,
  selectedOperatorId,
  siteModuleType,
  onSelect,
}: {
  entry: AddressAttachments;
  label: string;
  open: boolean;
  onToggle: () => void;
  selectedAddress?: string;
  selectedOperatorId?: string;
  siteModuleType: ModuleType;
  onSelect: Props['onSelect'];
}) {
  const { copy, isCopied } = useCopyAddress();
  const copied = isCopied(entry.address);
  const connected = selectedAddress?.toLowerCase() === entry.address.toLowerCase();

  return (
    <div className={`addr-card ${connected ? 'selected' : ''}`}>
      {/* A div, not a button: the copy control lives inside and buttons cannot nest. */}
      <div className="addr-head" onClick={onToggle}>
        <span className={`addr-caret ${open ? 'open' : ''}`} aria-hidden>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 2L7 5L3.5 8" />
          </svg>
        </span>
        <span className="addr-text mono">{truncateAddress(entry.address)}</span>
        {label && <span className="addr-label">{label}</span>}
        <div className="spacer" />
        <span className={`attach-count ${entry.crossModule ? 'cross' : ''}`}>
          {countLabel(entry)}
        </span>
        <button
          className={`chip-copy ${copied ? 'copied' : ''}`}
          onClick={(e) => { e.stopPropagation(); copy(entry.address); }}
          title="Copy address"
        >
          {copied ? '✓' : '⎘'}
        </button>
      </div>

      {open && (
        <div className="addr-body">
          {entry.attachments.map((att) => (
            <AttachmentRow
              key={`${att.moduleType}:${att.operatorId}`}
              attachment={att}
              // (id, module) — CSM #7 and CM #7 are different operators.
              inUse={
                connected &&
                selectedOperatorId === att.operatorId &&
                siteModuleType === att.moduleType
              }
              siteModuleType={siteModuleType}
              onSelect={() =>
                onSelect(entry.address, att.operatorId, att.primaryRole, att.moduleType)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment: att,
  inUse,
  siteModuleType,
  onSelect,
}: {
  attachment: Attachment;
  inUse: boolean;
  siteModuleType: ModuleType;
  onSelect: () => void;
}) {
  const crossModule = att.moduleType !== siteModuleType;

  return (
    <div
      className={`attach-row kind-${att.kind} ${inUse ? 'current' : ''}`}
      onClick={inUse ? undefined : onSelect}
      title={crossModule ? `Switches the module to ${att.moduleType.toUpperCase()}` : undefined}
    >
      <span className="attach-ribbon" />
      <span className="attach-id mono">#{att.operatorId}</span>
      <span className="attach-type">{att.typeLabel}</span>
      <div className="chip-pills">
        {att.pills.map((p) => (
          <span
            key={p.label}
            className={`role-pill ${p.proposed ? 'dashed' : `tint-${p.tint}`} ${p.owner ? 'owner' : ''}`}
          >
            {p.label}
          </span>
        ))}
      </div>
      <div className="spacer" />
      {inUse && <span className="attach-here">in use</span>}
    </div>
  );
}
