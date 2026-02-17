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
  return (
    <div className="module-selector">
      {MODULES.map((m) => {
        const disabled = availableModules[m.type] === false;
        return (
          <button
            key={m.type}
            className={`module-pill ${moduleType === m.type ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
            disabled={disabled}
            onClick={() => onSwitch(m.type)}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
