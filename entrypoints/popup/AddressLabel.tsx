import React, { useState, useRef, useEffect } from 'react';

type Props = {
  address: string;
  label: string;
  onSave: (label: string) => void;
};

export function AddressLabel({ label, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(label); }, [label]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== label) onSave(draft.trim());
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="address-label-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(label); setEditing(false); }
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder="Add label..."
      />
    );
  }

  return (
    <>
      {label && <span className="address-label">{label}</span>}
      <button
        className="btn-edit-label"
        onClick={(e) => { e.stopPropagation(); setDraft(label); setEditing(true); }}
        title={label ? 'Edit label' : 'Add label'}
      >
        &#x270E;
      </button>
    </>
  );
}
