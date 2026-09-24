import React from 'react';
import type { ModuleType } from '../../lib/shared/types.js';
import { attachSummary, attachmentKey, countLabel, type AddressAttachments, type Attachment } from '../../lib/shared/attachments.js';
import { AttachmentRow } from './AttachmentRow.js';

type Props = {
  entry?: AddressAttachments;
  loading: boolean;
  siteModuleType: ModuleType;
  operatorLabel: (operatorId: string, moduleType: ModuleType) => string;
  onSelect: (attachment: Attachment) => void;
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

  const capped = entry.attachments.length > 5;

  return (
    <span className="ops-anchor">
      <button className={`ops-trigger attach-count ${entry.crossModule ? 'cross' : ''}`}>
        {attachSummary(entry)}
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
              key={attachmentKey(att)}
              attachment={att}
              siteModuleType={siteModuleType}
              label={att.type === 'operator' ? operatorLabel(att.operatorId, att.moduleType) : ''}
              editableLabel={false}
              onSelect={() => onSelect(att)}
            />
          ))}
        </div>
      </div>
    </span>
  );
}
