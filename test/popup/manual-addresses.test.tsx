import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ManualAddresses } from '../../entrypoints/popup/ManualAddresses.js';

// Valid checksummed Ethereum address
const VALID_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const _VALID_ADDR2 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';

describe('ManualAddresses', () => {
  const defaultProps = {
    addresses: [] as `0x${string}`[],
    selectedAddress: undefined,
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onSelect: vi.fn(),
  };

  it('shows empty state when no addresses', () => {
    render(<ManualAddresses {...defaultProps} />);
    expect(screen.getByText(/no manual addresses/i)).toBeInTheDocument();
  });

  it('calls onAdd with valid address and clears input', () => {
    const onAdd = vi.fn();
    render(<ManualAddresses {...defaultProps} onAdd={onAdd} />);

    const input = screen.getByPlaceholderText(/0x address/i);
    fireEvent.change(input, { target: { value: VALID_ADDR } });
    fireEvent.click(screen.getByText('Add'));

    expect(onAdd).toHaveBeenCalledWith(VALID_ADDR);
    expect(input).toHaveValue('');
  });

  it('does NOT call onAdd with invalid address', () => {
    const onAdd = vi.fn();
    render(<ManualAddresses {...defaultProps} onAdd={onAdd} />);

    const input = screen.getByPlaceholderText(/0x address/i);
    fireEvent.change(input, { target: { value: 'not-an-address' } });
    fireEvent.click(screen.getByText('Add'));

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('Enter key triggers add for valid address', () => {
    const onAdd = vi.fn();
    render(<ManualAddresses {...defaultProps} onAdd={onAdd} />);

    const input = screen.getByPlaceholderText(/0x address/i);
    fireEvent.change(input, { target: { value: VALID_ADDR } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onAdd).toHaveBeenCalledWith(VALID_ADDR);
  });

  it('renders address list and click calls onSelect', () => {
    const onSelect = vi.fn();
    render(
      <ManualAddresses
        {...defaultProps}
        addresses={[VALID_ADDR as `0x${string}`]}
        onSelect={onSelect}
      />,
    );

    // Address row should be rendered (truncated)
    const addressRow = screen.getByText(/0xd8dA\.\.\.6045/);
    fireEvent.click(addressRow);

    expect(onSelect).toHaveBeenCalledWith(VALID_ADDR);
  });

  it('Remove button calls onRemove', () => {
    const onRemove = vi.fn();
    render(
      <ManualAddresses
        {...defaultProps}
        addresses={[VALID_ADDR as `0x${string}`]}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByText('Remove'));
    expect(onRemove).toHaveBeenCalledWith(VALID_ADDR);
  });
});
