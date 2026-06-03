import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnvilAccounts } from '../../entrypoints/popup/AnvilAccounts.js';

const ADDR_A = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const ADDR_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('AnvilAccounts', () => {
  const baseProps = {
    accounts: [] as `0x${string}`[],
    forkedFrom: null as number | null,
    selectedAddress: undefined,
    addressLabels: {} as Record<string, string>,
    onSetLabel: vi.fn(),
    onSelect: vi.fn(),
  };

  it('empty state: prompts to start a fork when no fork detected', () => {
    render(<AnvilAccounts {...baseProps} />);
    expect(screen.getByText(/anvil not detected/i)).toBeInTheDocument();
  });

  it('empty state: distinct message when forked but no accounts returned', () => {
    render(<AnvilAccounts {...baseProps} forkedFrom={1} />);
    expect(screen.getByText(/no pre-funded accounts/i)).toBeInTheDocument();
  });

  it('renders accounts with index labels and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <AnvilAccounts
        {...baseProps}
        forkedFrom={1}
        accounts={[ADDR_A as `0x${string}`, ADDR_B as `0x${string}`]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('#0')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/0xd8dA…6045/));
    expect(onSelect).toHaveBeenCalledWith(ADDR_A, 0);

    fireEvent.click(screen.getByText(/0x7099…79C8/));
    expect(onSelect).toHaveBeenCalledWith(ADDR_B, 1);
  });

  it('marks selected account with the selected class', () => {
    const { container } = render(
      <AnvilAccounts
        {...baseProps}
        forkedFrom={1}
        accounts={[ADDR_A as `0x${string}`]}
        selectedAddress={ADDR_A}
      />,
    );
    expect(container.querySelector('.manual-entry.selected')).not.toBeNull();
  });
});
