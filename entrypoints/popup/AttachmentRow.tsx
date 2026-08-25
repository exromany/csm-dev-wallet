import React from 'react';
import type { ModuleType } from '../../lib/shared/types.js';
import { roleHint, typeHint, type Attachment } from '../../lib/shared/attachments.js';
import { LabelEditor } from './LabelEditor.js';

type Props = {
  attachment: Attachment;
  siteModuleType: ModuleType;
  label: string;
  onSelect: () => void;
} & (
  | { editableLabel?: true; onSetLabel: (label: string) => void }
  | { editableLabel: false; onSetLabel?: undefined }
);

export function AttachmentRow({
  attachment: att,
  siteModuleType,
  label,
  onSetLabel,
  onSelect,
  editableLabel = true,
}: Props) {
  return (
    <div
      className={`attach-row kind-${att.kind}`}
      onClick={onSelect}
    >
      <span className="attach-ribbon" />
      <span className="attach-id mono">#{att.operatorId}</span>
      <span className="attach-type hint" data-hint={typeHint(att, siteModuleType)}>{att.typeLabel}</span>
      {editableLabel ? (
        <LabelEditor label={label} onSave={onSetLabel!} className="operator-label" />
      ) : (
        label && <span className="operator-label"><span className="text">{label}</span></span>
      )}
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
