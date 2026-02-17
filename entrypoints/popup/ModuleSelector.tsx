import React from 'react';
import type { ModuleType } from '../../lib/shared/types.js';

const MODULES: { type: ModuleType; label: string }[] = [
  { type: 'csm', label: 'CSM' },
  { type: 'cm', label: 'CM' },
];

export function ModuleSelector({
  moduleType,
  onSwitch,
}: {
  moduleType: ModuleType;
  onSwitch: (moduleType: ModuleType) => void;
}) {
  return (
    <div className="module-selector">
      {MODULES.map((m) => (
        <button
          key={m.type}
          className={`module-pill ${moduleType === m.type ? 'active' : ''}`}
          onClick={() => onSwitch(m.type)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
