import React, { useMemo, useState } from 'react';
import type { ModuleType } from '../../lib/shared/types.js';
import { attachmentKey, countHint, countLabel, type Attachment, type AddressAttachments } from '../../lib/shared/attachments.js';
import { truncateAddress, formatTimeAgo } from '../../lib/popup/utils.js';
import { useCopyAddress, filterSharedAddresses, type SharedFilter } from '../../lib/popup/hooks.js';
import { LabelEditor } from './LabelEditor.js';
import { AttachmentRow } from './AttachmentRow.js';
import { IconCheck, IconClose, IconCopy, IconSearch } from './icons.js';

type OperatorLabels = {
  get: (operatorId: string, moduleType: ModuleType) => string;
  set: (operatorId: string, label: string, moduleType: ModuleType) => void;
};

type Props = {
  addresses: AddressAttachments[];
  loading: boolean;
  lastFetchedAt: number | null;
  addressLabels: Record<string, string>;
  operatorLabels: OperatorLabels;
  selectedAddress?: string;
  siteModuleType: ModuleType;
  gatesLoading: boolean;
  gateErrors: string[];
  onRefresh: () => void;
  onSelect: (address: string, attachment: Attachment) => void;
  onSetAddressLabel: (address: string, label: string) => void;
};

export function SharedAddresses({
  addresses,
  loading,
  lastFetchedAt,
  addressLabels,
  operatorLabels,
  selectedAddress,
  siteModuleType,
  gatesLoading,
  gateErrors,
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

  const hints: Partial<Record<SharedFilter, string>> = {
    pending: 'Addresses caught up in a proposed role change',
    claimer: 'Addresses set as a custom rewards claimer',
    gate: 'Addresses with an unused gate proof — including ones not on any operator',
  };
  // Claimer/Gate sit near the bar's right edge — a left-anchored tooltip
  // would run past it, so they open leftward like the gate-warn icon.
  const rightAnchored = new Set<SharedFilter>(['claimer', 'gate']);

  const gateView = filter === 'gate';
  const busy = gateView ? gatesLoading : loading;

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
              ['claimer', 'Claimer'],
              ['gate', 'Gate'],
            ] satisfies ReadonlyArray<readonly [SharedFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              className={`filter-btn ${hints[value] ? 'hint' : ''} ${rightAnchored.has(value) ? 'hint-right' : ''} ${filter === value ? 'active' : ''}`}
              onClick={() => setFilter(value)}
              data-hint={hints[value]}
            >
              {label}
            </button>
          ))}
          <div className="spacer" />
          {gateErrors.length > 0 && (
            <span className="gate-warn hint hint-right" data-hint={`Gate tree unavailable: ${gateErrors.join(', ')}`}>⚠</span>
          )}
          {lastFetchedAt && (
            <span className="staleness-label">updated {formatTimeAgo(lastFetchedAt)}</span>
          )}
          <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
            {loading ? 'loading…' : '↻ refresh'}
          </button>
        </div>
      </div>

      {busy && shown.length === 0 ? (
        <div className="loading">
          <div className="spinner" />
          <p>{gateView ? 'Loading gate trees…' : 'Loading operators...'}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state-rich">
          <div className="empty-glyph">⇉</div>
          <div className="empty-headline">{gateView ? 'No unused gate proofs' : 'No shared addresses'}</div>
          <div className="empty-hint">
            {gateView
              ? "Addresses in a gate's merkle tree that haven't used their proof yet show up here."
              : 'Addresses attached to more than one operator, at least one in the current module, show up here.'}
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
          aria-label={copied ? 'Copied' : 'Copy address'}
        >
          {copied ? <IconCheck /> : <IconCopy />}
        </button>
      </div>

      {open && (
        <div className="addr-body">
          {entry.attachments.map((att) =>
            att.type === 'operator' ? (
              <AttachmentRow
                key={attachmentKey(att)}
                attachment={att}
                siteModuleType={siteModuleType}
                label={operatorLabels.get(att.operatorId, att.moduleType)}
                onSetLabel={(l) => operatorLabels.set(att.operatorId, l, att.moduleType)}
                onSelect={() => onSelect(entry.address, att)}
              />
            ) : (
              <AttachmentRow
                key={attachmentKey(att)}
                attachment={att}
                siteModuleType={siteModuleType}
                label=""
                editableLabel={false}
                onSelect={() => onSelect(entry.address, att)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
