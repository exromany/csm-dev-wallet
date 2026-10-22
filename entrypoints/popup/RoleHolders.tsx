import React from 'react';
import type { Address } from 'viem';
import type { ProtocolRole } from '@lidofinance/lido-csm-sdk/common';
import type { ModuleType } from '../../lib/shared/types.js';
import { MODULE_SHORT } from '../../lib/shared/modules.js';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress, type RoleGroup } from '../../lib/popup/hooks.js';
import { IconCheck, IconCopy } from './icons.js';

type Props = {
  groups: RoleGroup[];
  loading: boolean;
  selectedAddress?: string;
  addressLabels: Record<string, string>;
  onSelect: (address: Address, role: ProtocolRole, moduleType: ModuleType) => void;
  onRefresh: () => void;
};

export function RoleHolders({ groups, loading, selectedAddress, addressLabels, onSelect, onRefresh }: Props) {
  const { copy, isCopied } = useCopyAddress();

  return (
    <div className="panel">
      <div className="roles-bar">
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
            {entries.map(({ moduleType, holders, error }) => {
              const tag = MODULE_SHORT[moduleType];
              if (error) {
                return (
                  <div key={moduleType} className="role-note error hint" data-hint={error}>{tag} ⚠</div>
                );
              }
              if (holders.length === 0) {
                return <div key={moduleType} className="role-note">{tag} — no holders</div>;
              }
              return holders.map(({ address, isContract }) => {
                const label = addressLabels[address.toLowerCase()] ?? '';
                const selected = selectedAddress?.toLowerCase() === address.toLowerCase();
                const copied = isCopied(address);
                return (
                  <div
                    key={`${moduleType}:${address}`}
                    className={`role-row ${selected ? 'selected' : ''}`}
                    onClick={() => onSelect(address, role, moduleType)}
                  >
                    <span className="role-module">{tag}</span>
                    <div className="body">
                      {label && <div className="role-label">{label}</div>}
                      <div className="addr">{truncateAddress(address)}</div>
                    </div>
                    {isContract !== undefined && <span className="role-kind">{isContract ? 'contract' : 'EOA'}</span>}
                    <button
                      className={`btn-copy hint hint-right ${copied ? 'copied' : ''}`}
                      onClick={(e) => { e.stopPropagation(); copy(address); }}
                      data-hint={copied ? 'Copied' : 'Copy address'}
                      aria-label={copied ? 'Copied' : 'Copy address'}
                    >
                      {copied ? <IconCheck /> : <IconCopy />}
                    </button>
                  </div>
                );
              });
            })}
          </details>
        ))
      )}
    </div>
  );
}
