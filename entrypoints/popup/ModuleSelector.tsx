import React from 'react';
import type { ModuleType } from '../../lib/shared/types.js';
import type { ModuleAvailability } from '../../lib/shared/messages.js';

const MODULES: { type: ModuleType; label: string }[] = [
  { type: 'csm', label: 'CSM' },
  { type: 'cm', label: 'CM' },
];

export function ModuleSelector({
  moduleType,
  availableModules,
  onSwitch,
}: {
  moduleType: ModuleType;
  availableModules: ModuleAvailability;
  onSwitch: (moduleType: ModuleType) => void;
}) {
  const visible = MODULES.filter((m) => availableModules[m.type] !== false);

  if (visible.length <= 1) return null;

  return (
    <div className="module-selector">
      {visible.map((m) => (
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
