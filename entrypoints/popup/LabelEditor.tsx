import React, { useEffect, useRef, useState } from 'react';
import { IconPencil } from './icons.js';

type Props = {
  label: string;
  onSave: (label: string) => void;
  className?: string;
  placeholder?: string;
  // Visual style for the button form when no label is set.
  emptyText?: string;
};

// Inline label editor used for operator and manual-address labels.
//
// Save policy: blur saves only non-empty edits (preserves the existing label
// when the user accidentally clears the field and clicks away). Pressing Enter
// commits whatever is typed, including an empty string — that is the only way
// to clear a label, so deletion is always deliberate.
export function LabelEditor({
  label,
  onSave,
  className = 'operator-label',
  placeholder = 'Label…',
  emptyText = '+ label',
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(label); }, [label]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = (allowEmpty: boolean) => {
    const next = draft.trim();
    setEditing(false);
    if (next === label) return;
    if (!next && !allowEmpty) {
      setDraft(label);
      return;
    }
    onSave(next);
  };
  const cancel = () => { setDraft(label); setEditing(false); };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`${className}-input`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(true);
          if (e.key === 'Escape') cancel();
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
      />
    );
  }

  return (
    <button
      className={`${className} hint ${label ? '' : 'empty'}`}
      onClick={(e) => { e.stopPropagation(); setDraft(label); setEditing(true); }}
      data-hint={label ? 'Edit label' : 'Add label'}
    >
      {label && <span className="text">{label}</span>}
      <span className="pencil">{label ? <IconPencil size={11} /> : emptyText}</span>
    </button>
  );
}
