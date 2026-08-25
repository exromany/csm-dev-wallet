import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  NetworkModuleChip,
  NetworkModulePanel,
} from '../../entrypoints/popup/NetworkSelector.js';
import type { ModuleAvailability } from '../../lib/shared/messages.js';

const MAINNET = 1;
const HOODI = 560048;
const ANVIL = 31337;

describe('NetworkModuleChip', () => {
  const base = {
    chainId: MAINNET,
    moduleType: 'csm' as const,
    forkedFrom: null as number | null,
    open: false,
  };

  it('shows the network name and module for the active selection', () => {
    render(<NetworkModuleChip {...base} chainId={HOODI} moduleType="cm" />);
    expect(screen.getByText('Hoodi')).toBeInTheDocument();
    expect(screen.getByText('CM')).toBeInTheDocument();
  });

  it('labels a running Anvil fork with the network it forks', () => {
    const { rerender } = render(
      <NetworkModuleChip {...base} chainId={ANVIL} forkedFrom={MAINNET} />,
    );
    expect(screen.getByText('Anvil (Mainnet)')).toBeInTheDocument();

    rerender(<NetworkModuleChip {...base} chainId={ANVIL} forkedFrom={HOODI} />);
    expect(screen.getByText('Anvil (Hoodi)')).toBeInTheDocument();
  });

  it('shows a bare "Anvil" label when on Anvil with no fork detected', () => {
    render(<NetworkModuleChip {...base} chainId={ANVIL} forkedFrom={null} />);
    expect(screen.getByText('Anvil')).toBeInTheDocument();
  });

  it('flips the caret to reflect the open state', () => {
    const { container, rerender } = render(<NetworkModuleChip {...base} open={false} />);
    expect(container.querySelector('.caret')?.className).not.toContain('up');
    rerender(<NetworkModuleChip {...base} open={true} />);
    expect(container.querySelector('.caret')?.className).toContain('up');
  });

  it('is a declarative popover invoker that toggles the panel', () => {
    render(<NetworkModuleChip {...base} />);
    const chip = screen.getByRole('button');
    // The chip drives the popover through native attributes, not a JS onClick —
    // this is what replaced the old onToggle handler.
    expect(chip.getAttribute('popovertarget')).toBe('netmod-panel');
    expect(chip.getAttribute('popovertargetaction')).toBe('toggle');
  });
});

describe('NetworkModulePanel', () => {
  const base = {
    chainId: MAINNET,
    moduleType: 'csm' as const,
    forkedFrom: null as number | null,
    availableModules: { csm: true, cm: true } as ModuleAvailability,
    onSwitchNetwork: vi.fn(),
    onSwitchModule: vi.fn(),
    onOpenChange: vi.fn(),
  };

  it('renders as a popover whose id matches the chip that targets it', () => {
    const { container } = render(
      <>
        <NetworkModuleChip
          chainId={MAINNET}
          moduleType="csm"
          forkedFrom={null}
          open={false}
        />
        <NetworkModulePanel {...base} />
      </>,
    );
    const chip = container.querySelector('.netmod-chip')!;
    const panel = container.querySelector('.netmod-panel')!;
    expect(panel.getAttribute('popover')).toBe('auto');
    // The wiring invariant: break this and the popover never opens.
    expect(panel.id).toBe(chip.getAttribute('popovertarget'));
  });

  it('marks the active network and module', () => {
    const { container } = render(
      <NetworkModulePanel {...base} chainId={HOODI} moduleType="cm" />,
    );
    expect(
      container.querySelector('.netmod-option[data-chain-id="560048"]')?.className,
    ).toContain('active');
    expect(
      container.querySelector('.netmod-option[data-module-type="cm"]')?.className,
    ).toContain('active');
  });

  it('switches network when a network option is clicked', () => {
    const onSwitchNetwork = vi.fn();
    const { container } = render(
      <NetworkModulePanel {...base} onSwitchNetwork={onSwitchNetwork} />,
    );
    fireEvent.click(container.querySelector('.netmod-option[data-chain-id="560048"]')!);
    expect(onSwitchNetwork).toHaveBeenCalledWith(HOODI);
  });

  it('switches module when a module option is clicked', () => {
    const onSwitchModule = vi.fn();
    const { container } = render(
      <NetworkModulePanel {...base} onSwitchModule={onSwitchModule} />,
    );
    fireEvent.click(container.querySelector('.netmod-option[data-module-type="cm"]')!);
    expect(onSwitchModule).toHaveBeenCalledWith('cm');
  });

  it('disables the Anvil option until a fork is detected', () => {
    const { container, rerender } = render(<NetworkModulePanel {...base} />);
    const anvilOption = () =>
      container.querySelector<HTMLButtonElement>('.netmod-option[data-chain-id="31337"]')!;
    // Mainnet, no fork → Anvil unreachable.
    expect(anvilOption().disabled).toBe(true);
    // Fork detected → selectable.
    rerender(<NetworkModulePanel {...base} forkedFrom={MAINNET} />);
    expect(anvilOption().disabled).toBe(false);
  });

  it('keeps the Anvil option enabled while already on Anvil', () => {
    const { container } = render(
      <NetworkModulePanel {...base} chainId={ANVIL} forkedFrom={null} />,
    );
    expect(
      container.querySelector<HTMLButtonElement>('.netmod-option[data-chain-id="31337"]')!
        .disabled,
    ).toBe(false);
  });

  it('disables a module that is unavailable on the current network', () => {
    const { container } = render(
      <NetworkModulePanel {...base} availableModules={{ csm: true, cm: false }} />,
    );
    expect(
      container.querySelector<HTMLButtonElement>('.netmod-option[data-module-type="cm"]')!
        .disabled,
    ).toBe(true);
  });

  it('reports open-state changes from the popover toggle event', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <NetworkModulePanel {...base} onOpenChange={onOpenChange} />,
    );
    const panel = container.querySelector('.netmod-panel')!;

    const opened = new Event('toggle');
    Object.defineProperty(opened, 'newState', { value: 'open' });
    fireEvent(panel, opened);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    const closed = new Event('toggle');
    Object.defineProperty(closed, 'newState', { value: 'closed' });
    fireEvent(panel, closed);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });
});
