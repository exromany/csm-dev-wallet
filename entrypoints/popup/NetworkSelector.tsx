import React from 'react';
import type { ModuleType } from '../../lib/shared/types.js';
import type { ModuleAvailability } from '../../lib/shared/messages.js';
import { CHAIN_ID, ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';

// The chip is a native popover invoker; the panel is the popover it targets.
// One shared id ties `popovertarget` on the chip to `id` on the panel, and lets
// CSS anchor-position the panel under the chip — no JS positioning, no layout
// shift, and the browser handles light-dismiss (click-outside / Esc) for us.
const PANEL_ID = 'netmod-panel';

type Network = {
  id: number;
  label: string;
  dot: string;
};

const NETWORKS: Network[] = [
  { id: CHAIN_ID.Mainnet, label: 'Mainnet', dot: '#22c55e' },
  { id: CHAIN_ID.Hoodi, label: 'Hoodi', dot: '#a78bfa' },
  { id: ANVIL_CHAIN_ID, label: 'Anvil', dot: '#fb923c' },
];

const MODULES: { type: ModuleType; label: string }[] = [
  { type: 'csm', label: 'CSM' },
  { type: 'cm', label: 'CM' },
];

function netLabel(chainId: number, forkedFrom?: number | null): string {
  if (chainId !== ANVIL_CHAIN_ID || !forkedFrom) {
    return NETWORKS.find((n) => n.id === chainId)?.label ?? String(chainId);
  }
  const source = forkedFrom === CHAIN_ID.Mainnet ? 'Mainnet' : 'Hoodi';
  return `Anvil (${source})`;
}

type ChipProps = {
  chainId: number;
  moduleType: ModuleType;
  forkedFrom?: number | null;
  open: boolean;
};

export function NetworkModuleChip({
  chainId,
  moduleType,
  forkedFrom,
  open,
}: ChipProps) {
  const net = NETWORKS.find((n) => n.id === chainId);
  const mod = MODULES.find((m) => m.type === moduleType);
  return (
    <button
      className="netmod-chip hint hint-right"
      popoverTarget={PANEL_ID}
      popoverTargetAction="toggle"
      data-hint="Switch network or module"
    >
      <span className="dot" style={{ background: net?.dot ?? 'var(--dim)' }} />
      <span className="net-label">{netLabel(chainId, forkedFrom)}</span>
      <span className="sep">/</span>
      <span className="mod-label">{mod?.label ?? moduleType.toUpperCase()}</span>
      <span className="caret">{open ? '▴' : '▾'}</span>
    </button>
  );
}

type PanelProps = {
  chainId: number;
  moduleType: ModuleType;
  forkedFrom?: number | null;
  availableModules: ModuleAvailability;
  onSwitchNetwork: (chainId: number) => void;
  onSwitchModule: (moduleType: ModuleType) => void;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
};

export function NetworkModulePanel({
  chainId,
  moduleType,
  forkedFrom,
  availableModules,
  onSwitchNetwork,
  onSwitchModule,
  onOpenChange,
  onOpenSettings,
}: PanelProps) {
  return (
    <div
      id={PANEL_ID}
      // eslint-disable-next-line react/no-unknown-property -- native Popover API
      popover="auto"
      className="netmod-panel"
      onToggle={(e) => onOpenChange(e.nativeEvent.newState === 'open')}
    >
      <div className="netmod-networks">
        {NETWORKS.map((n) => {
          const disabledAnvil =
            n.id === ANVIL_CHAIN_ID && !forkedFrom && chainId !== ANVIL_CHAIN_ID;
          return (
            <button
              key={n.id}
              className={`netmod-option ${n.id === chainId ? 'active' : ''}`}
              data-chain-id={n.id}
              disabled={disabledAnvil}
              onClick={() => onSwitchNetwork(n.id)}
            >
              <span className="dot" style={{ background: n.dot }} />
              {n.label}
            </button>
          );
        })}
      </div>
      <div className="netmod-divider" />
      <div className="netmod-modules">
        {MODULES.map((m) => {
          const disabled = availableModules[m.type] === false;
          return (
            <button
              key={m.type}
              className={`netmod-option mod ${m.type === moduleType ? 'active' : ''}`}
              data-module-type={m.type}
              disabled={disabled}
              onClick={() => onSwitchModule(m.type)}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <div className="netmod-divider" />
      <button
        className="netmod-option settings"
        popoverTarget={PANEL_ID}
        popoverTargetAction="hide"
        onClick={onOpenSettings}
      >
        <span className="gear" aria-hidden>⚙</span> Settings
      </button>
    </div>
  );
}
