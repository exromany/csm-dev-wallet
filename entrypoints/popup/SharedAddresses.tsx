import React, { useMemo, useState } from 'react';
import type { AddressRole, ModuleType } from '../../lib/shared/types.js';
import {
  countHint,
  countLabel,
  roleHint,
  typeHint,
  type AddressAttachments,
  type Attachment,
} from '../../lib/shared/attachments.js';
import { truncateAddress, formatTimeAgo } from '../../lib/popup/utils.js';
import { useCopyAddress, filterSharedAddresses, type SharedFilter } from '../../lib/popup/hooks.js';
import { LabelEditor } from './LabelEditor.js';
import { IconCheck, IconClose, IconCopy, IconSearch } from './icons.js';

type OperatorLabels = {
  get: (operatorId: string, moduleType: ModuleType) => string;
  set: (operatorId: string, label: string, moduleType: ModuleType) => void;
};

type Props = {
  addresses: AddressAttachments[];
  loading: boolean;
  lastFetchedAt: number | null;
  cmMissing: boolean;
  addressLabels: Record<string, string>;
  operatorLabels: OperatorLabels;
  selectedAddress?: string;
  siteModuleType: ModuleType;
  onRefresh: () => void;
  onSelect: (
    address: string,
    operatorId: string,
    role: AddressRole,
    moduleType: ModuleType,
  ) => void;
  onSetAddressLabel: (address: string, label: string) => void;
};

export function SharedAddresses({
  addresses,
  loading,
  lastFetchedAt,
  cmMissing,
  addressLabels,
  operatorLabels,
  selectedAddress,
  siteModuleType,
  onRefresh,
  onSelect,
  onSetAddressLabel,
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
            <span className="search-icon"><IconSearch size={14} /></span>
            <input
              placeholder="Search address, label, #ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => setSearch('')}><IconClose size={12} /></button>
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
              className={`filter-btn ${value === 'pending' ? 'hint' : ''} ${filter === value ? 'active' : ''}`}
              onClick={() => setFilter(value)}
              data-hint={
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
                siteModuleType={siteModuleType}
                operatorLabels={operatorLabels}
                onSelect={onSelect}
                onSetAddressLabel={onSetAddressLabel}
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
  siteModuleType,
  operatorLabels,
  onSelect,
  onSetAddressLabel,
}: {
  entry: AddressAttachments;
  label: string;
  open: boolean;
  onToggle: () => void;
  selectedAddress?: string;
  siteModuleType: ModuleType;
  operatorLabels: OperatorLabels;
  onSelect: Props['onSelect'];
  onSetAddressLabel: Props['onSetAddressLabel'];
}) {
  const { copy, isCopied } = useCopyAddress();
  const copied = isCopied(entry.address);
  const connected = selectedAddress?.toLowerCase() === entry.address.toLowerCase();

  return (
    <div className={`addr-card ${connected ? 'selected' : ''}`}>
      {/* A div, not a button: the copy control lives inside and buttons cannot nest. */}
      <div className={`addr-head ${open ? 'expanded' : ''}`} onClick={onToggle}>
        <span className={`addr-caret ${open ? 'open' : ''}`} aria-hidden>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.5 2L7 5L3.5 8" />
          </svg>
        </span>
        <span className="addr-text mono">{truncateAddress(entry.address)}</span>
        <LabelEditor
          label={label}
          onSave={(l) => onSetAddressLabel(entry.address, l)}
          className="operator-label"
        />
        <div className="spacer" />
        <span
          className={`attach-count hint hint-right ${entry.crossModule ? 'cross' : ''}`}
          data-hint={countHint(entry)}
        >
          {countLabel(entry)}
        </span>
        <button
          className={`chip-copy hint hint-right ${copied ? 'copied' : ''}`}
          onClick={(e) => { e.stopPropagation(); copy(entry.address); }}
          data-hint={copied ? 'Copied' : 'Copy address'}
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
      </div>

      {open && (
        <div className="addr-body">
          {entry.attachments.map((att) => (
            <AttachmentRow
              key={`${att.moduleType}:${att.operatorId}`}
              attachment={att}
              siteModuleType={siteModuleType}
              label={operatorLabels.get(att.operatorId, att.moduleType)}
              onSetLabel={(l) => operatorLabels.set(att.operatorId, l, att.moduleType)}
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
  siteModuleType,
  label,
  onSetLabel,
  onSelect,
}: {
  attachment: Attachment;
  siteModuleType: ModuleType;
  label: string;
  onSetLabel: (label: string) => void;
  onSelect: () => void;
}) {

  return (
    <div
      className={`attach-row kind-${att.kind}`}
      onClick={onSelect}
    >
      <span className="attach-ribbon" />
      <span className="attach-id mono">#{att.operatorId}</span>
      <span className="attach-type hint" data-hint={typeHint(att, siteModuleType)}>{att.typeLabel}</span>
      <LabelEditor label={label} onSave={onSetLabel} className="operator-label" />
      <div className="spacer" />
      <div className="chip-pills">
        {att.pills.map((p) => (
          <span
            key={p.label}
            className={`role-pill hint hint-right ${p.proposed ? 'dashed' : `tint-${p.tint}`} ${p.owner ? 'owner' : ''}`}
            data-hint={roleHint(p)}
          >
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}
