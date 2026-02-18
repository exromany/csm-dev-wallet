import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Settings } from '../../entrypoints/popup/Settings.js';
import { makeState } from '../fixtures.js';

describe('Settings', () => {
  it('renders 3 RPC inputs', () => {
    const onSetRpc = vi.fn();
    render(<Settings state={makeState()} onSetRpc={onSetRpc} onSetRequireApproval={vi.fn()} />);

    expect(screen.getByText('Mainnet RPC')).toBeInTheDocument();
    expect(screen.getByText('Hoodi RPC')).toBeInTheDocument();
    expect(screen.getByText('Anvil RPC')).toBeInTheDocument();
  });

  it('fires onSetRpc on blur when value changed', () => {
    const onSetRpc = vi.fn();
    render(<Settings state={makeState()} onSetRpc={onSetRpc} onSetRequireApproval={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    const mainnetInput = inputs[0];

    fireEvent.change(mainnetInput, { target: { value: 'https://my-rpc.io' } });
    fireEvent.blur(mainnetInput);

    expect(onSetRpc).toHaveBeenCalledWith(1, 'https://my-rpc.io');
  });

  it('fires onSetRpc on Enter when value changed', () => {
    const onSetRpc = vi.fn();
    render(<Settings state={makeState()} onSetRpc={onSetRpc} onSetRequireApproval={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'https://new-rpc.io' } });
    fireEvent.keyDown(inputs[0], { key: 'Enter' });

    expect(onSetRpc).toHaveBeenCalledWith(1, 'https://new-rpc.io');
  });

  it('does NOT fire onSetRpc on blur when value unchanged', () => {
    const onSetRpc = vi.fn();
    render(<Settings state={makeState()} onSetRpc={onSetRpc} onSetRequireApproval={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    fireEvent.blur(inputs[0]);

    expect(onSetRpc).not.toHaveBeenCalled();
  });

  it('shows current custom RPC in input value', () => {
    const onSetRpc = vi.fn();
    const state = makeState({ customRpcUrls: { 1: 'https://custom.io' } });
    render(<Settings state={state} onSetRpc={onSetRpc} onSetRequireApproval={vi.fn()} />);

    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0]).toHaveValue('https://custom.io');
  });

  it('syncs input value when currentUrl changes externally', () => {
    const onSetRpc = vi.fn();
    const { rerender } = render(
      <Settings state={makeState()} onSetRpc={onSetRpc} onSetRequireApproval={vi.fn()} />,
    );

    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0]).toHaveValue('');

    rerender(
      <Settings
        state={makeState({ customRpcUrls: { 1: 'https://updated.io' } })}
        onSetRpc={onSetRpc}
        onSetRequireApproval={vi.fn()}
      />,
    );

    const freshInputs = screen.getAllByRole('textbox');
    expect(freshInputs[0]).toHaveValue('https://updated.io');
  });
});
