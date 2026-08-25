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
  // On first load a half-built count is worse than none, so loading wins until an
  // entry exists. Once one does, a refresh keeps showing it — stale-but-known beats
  // the placeholder, and a settled absent entry means genuinely no attachments.
  if (loading && !entry) {
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
