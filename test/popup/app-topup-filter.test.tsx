import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState, makeOperator } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';
import type { ModuleType } from '../../lib/shared/types.js';

async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

function seed(port: MockPort, moduleType: ModuleType) {
  act(() => {
    port._emit({ type: 'state-update', state: makeState({ moduleType }) } satisfies PopupEvent);
  });
  act(() => {
    port._emit({
      type: 'operators-update',
      chainId: 1,
      moduleType,
      lastFetchedAt: 1_700_000_000_000,
      operators: [
        makeOperator({ id: '10', groupId: '3', groupName: 'Kiln', topUpDisabled: true }),
        makeOperator({ id: '11', groupId: '3', groupName: 'Kiln' }),
        makeOperator({ id: '12' }),
      ],
    } satisfies PopupEvent);
  });
}

const chip = () => screen.queryByRole('button', { name: 'Top-up' });
const rowIds = () => Array.from(document.querySelectorAll('.operator-id')).map((e) => e.textContent);

describe('App — Top-up filter', () => {
  let port: MockPort;
  beforeEach(() => { port = createMockPort(); });

  it('is hidden on CSM', async () => {
    await mountApp(port);
    seed(port, 'csm');
    expect(chip()).toBeNull();
  });

  it('narrows the Operators list on CM', async () => {
    await mountApp(port);
    seed(port, 'cm');
    fireEvent.click(chip()!);
    expect(rowIds()).toEqual(['#10']);
  });

  it('selecting the NO TOP-UP badge activates the chip', async () => {
    await mountApp(port);
    seed(port, 'cm');
    fireEvent.click(screen.getByText('NO TOP-UP'));
    expect(chip()).toHaveClass('active');
    expect(rowIds()).toEqual(['#10']);
  });

  it('stays visible and active on the Groups tab, narrowing members', async () => {
    await mountApp(port);
    seed(port, 'cm');
    fireEvent.click(chip()!);
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(chip()).toHaveClass('active');
    expect(screen.getByText('g·3')).toBeInTheDocument();
    expect(screen.queryByText('No group')).toBeNull();
  });

  it('behaves as All after switching to a non-CM module', async () => {
    await mountApp(port);
    seed(port, 'cm');
    fireEvent.click(chip()!);
    seed(port, 'csm');
    expect(chip()).toBeNull();
    expect(screen.getByRole('button', { name: 'All' })).toHaveClass('active');
    expect(rowIds()).toEqual(['#10', '#11', '#12']);
  });
});
