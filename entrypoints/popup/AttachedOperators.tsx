import React from 'react';
import type { AddressRole, ModuleType } from '../../lib/shared/types.js';
import { countLabel, type AddressAttachments } from '../../lib/shared/attachments.js';
import { AttachmentRow } from './AttachmentRow.js';

type Props = {
  entry?: AddressAttachments;
  loading: boolean;
  siteModuleType: ModuleType;
  operatorLabel: (operatorId: string, moduleType: ModuleType) => string;
  onSelect: (operatorId: string, role: AddressRole, moduleType: ModuleType) => void;
};

export function AttachedOperators({
  entry,
  loading,
  siteModuleType,
  operatorLabel,
  onSelect,
}: Props) {
  // A half-built count is worse than none: loading wins outright, so the pill
  // waits for every module to answer (see useSharedAddresses) before an entry
  // is trusted. Once settled, an absent entry means the address genuinely has
  // no attachments.
  if (loading) {
    return (
      <span className="attach-count pending-count hint hint-right" data-hint="Reading the operator cache…">
        ⋯
      </span>
    );
  }

  if (!entry) return null;

  const n = entry.attachments.length;
  const capped = n > 5;

  return (
    <span className="ops-anchor">
      <button className={`ops-trigger attach-count ${entry.crossModule ? 'cross' : ''}`}>
        {n} {n === 1 ? 'op' : 'ops'}
      </button>
      <div className={`ops-pop ${capped ? 'capped' : ''}`}>
        <div className="ops-pop-head">
          <span className="t">Attached to</span>
          <div className="spacer" />
          <span className={`attach-count ${entry.crossModule ? 'cross' : ''}`}>{countLabel(entry)}</span>
        </div>
        <div className="ops-scroll">
          {entry.attachments.map((att) => (
            <AttachmentRow
              key={`${att.moduleType}:${att.operatorId}`}
              attachment={att}
              siteModuleType={siteModuleType}
              label={operatorLabel(att.operatorId, att.moduleType)}
              editableLabel={false}
              onSelect={() => onSelect(att.operatorId, att.primaryRole, att.moduleType)}
            />
          ))}
        </div>
      </div>
    </span>
  );
}
