import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConnectedBar } from '../../entrypoints/popup/ConnectedBar.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { buildAttachmentIndex } from '../../lib/shared/attachments.js';
import { makeOperator, ADDR_A } from '../fixtures.js';
import type { SelectedAddress } from '../../lib/shared/types.js';

const selectedAddress: SelectedAddress = {
  address: ADDR_A,
  source: { type: 'manual' },
};

describe('ConnectedBar', () => {
  const defaultProps = {
    address: selectedAddress,
    chainId: 1,
    label: '',
    onSetLabel: vi.fn(),
    onDisconnect: vi.fn(),
  };

  it('renders the truncated address and a long label together', () => {
    render(<ConnectedBar {...defaultProps} label="a very long custom label for this address" />);

    expect(screen.getByText('0xaAaA…aaAa')).toBeInTheDocument();
    const label = screen.getByText('a very long custom label for this address');
    expect(label.className).toContain('text');
  });

  it('shows the watch mode chip off-Anvil', () => {
    render(<ConnectedBar {...defaultProps} chainId={1} />);

    const chip = screen.getByText('watch');
    expect(chip.closest('.mode')).toHaveAttribute(
      'data-hint',
      'Watch-only — signing requests from the dapp are rejected',
    );
  });

  it('shows the anvil mode chip on chainId 31337', () => {
    render(<ConnectedBar {...defaultProps} chainId={ANVIL_CHAIN_ID} />);

    const chip = screen.getByText('anvil');
    expect(chip.closest('.mode')).toHaveAttribute(
      'data-hint',
      'Anvil fork — transactions are signed by impersonating this account',
    );
  });

  it('calls onDisconnect when the disconnect button is clicked', () => {
    const onDisconnect = vi.fn();
    const { container } = render(<ConnectedBar {...defaultProps} onDisconnect={onDisconnect} />);

    fireEvent.click(container.querySelector('.pill-act.danger')!);

    expect(onDisconnect).toHaveBeenCalled();
  });

  it('shows "Copy address" hint on the copy button before copying', () => {
    const { container } = render(<ConnectedBar {...defaultProps} />);

    const copyButton = container.querySelector('.pill-act:not(.danger)');
    expect(copyButton).toHaveAttribute('data-hint', 'Copy address');
  });

  it('clicking the label opens the input seeded with the current label', () => {
    const { container } = render(<ConnectedBar {...defaultProps} label="Alice" />);

    fireEvent.click(container.querySelector('.pill-label')!);
    const input = container.querySelector('.pill-label-input') as HTMLInputElement;

    expect(input).toHaveValue('Alice');
  });

  it('pressing Enter calls onSetLabel with the typed value', () => {
    const onSetLabel = vi.fn();
    const { container } = render(<ConnectedBar {...defaultProps} onSetLabel={onSetLabel} />);

    fireEvent.click(container.querySelector('.pill-label')!);
    const input = container.querySelector('.pill-label-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Bob' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSetLabel).toHaveBeenCalledWith('Bob');
  });

  it('renders the attached-operators trigger when attachments are passed', () => {
    const entry = buildAttachmentIndex({
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A })],
    }).get(ADDR_A.toLowerCase());

    const { container } = render(
      <ConnectedBar
        {...defaultProps}
        attachments={entry}
        attachmentsLoading={false}
        siteModuleType="csm"
        operatorLabel={() => ''}
        onSelectAttachment={vi.fn()}
      />,
    );

    expect(container.querySelector('.ops-trigger')).toBeInTheDocument();
  });

  it('leaves the bar unchanged when no attachment props are passed', () => {
    const { container } = render(<ConnectedBar {...defaultProps} />);

    expect(container.querySelector('.ops-trigger')).not.toBeInTheDocument();
    expect(container.querySelector('.ops-anchor')).not.toBeInTheDocument();
  });
});
