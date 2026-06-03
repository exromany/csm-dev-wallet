import React, { useEffect, useRef } from 'react';
import type { ModuleType } from '../../lib/shared/types.js';
import type { ModuleAvailability } from '../../lib/shared/messages.js';
import { CHAIN_ID, ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';

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
  onToggle: () => void;
  chipRef?: React.RefObject<HTMLButtonElement | null>;
};

export function NetworkModuleChip({
  chainId,
  moduleType,
  forkedFrom,
  open,
  onToggle,
  chipRef,
}: ChipProps) {
  const net = NETWORKS.find((n) => n.id === chainId);
  const mod = MODULES.find((m) => m.type === moduleType);
  return (
    <button
      ref={chipRef}
      className="netmod-chip"
      onClick={onToggle}
      title="Switch network or module"
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
  onClose: () => void;
  chipRef?: React.RefObject<HTMLButtonElement | null>;
};

export function NetworkModulePanel({
  chainId,
  moduleType,
  forkedFrom,
  availableModules,
  onSwitchNetwork,
  onSwitchModule,
  onClose,
  chipRef,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (chipRef?.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose, chipRef]);

  return (
    <div className="netmod-panel" ref={panelRef}>
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
      <div className="netmod-divider" />
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
  );
}
