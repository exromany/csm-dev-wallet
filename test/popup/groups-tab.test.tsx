import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState, makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

const TEST_ORIGIN = 'https://stake.lido.fi';

async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

// Seed a CM site with two grouped operators + one ungrouped.
function seedCm(port: MockPort) {
  act(() => {
    port._emit({ type: 'state-update', state: makeState({ moduleType: 'cm' }) } satisfies PopupEvent);
  });
  act(() => {
    port._emit({
      type: 'operators-update',
      chainId: 1,
      moduleType: 'cm',
      lastFetchedAt: 1_700_000_000_000,
      operators: [
        makeOperator({ id: '10', groupId: '3', groupName: 'Kiln', managerAddress: ADDR_A }),
        makeOperator({ id: '11', groupId: '3', groupName: 'Kiln', managerAddress: ADDR_B }),
        makeOperator({ id: '12', managerAddress: ADDR_C }),
      ],
    } satisfies PopupEvent);
  });
}

describe('App — Groups tab behavior', () => {
  let port: MockPort;
  beforeEach(() => { port = createMockPort(); });

  it('renders the grouped accordion when the Groups tab is active', async () => {
    await mountApp(port);
    seedCm(port);

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    // Group header for group 3 and the ungrouped bucket are both present.
    expect(screen.getByText('g·3')).toBeInTheDocument();
    expect(screen.getByText('No group')).toBeInTheDocument();
  });

  it('shows search + All/Favorites but no Pending pill on the Groups tab', async () => {
    await mountApp(port);
    seedCm(port);
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    expect(screen.getByPlaceholderText('Search #ID, address, label…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pending' })).toBeNull();
  });

  it('persists the Groups tab via set-active-tab on click', async () => {
    await mountApp(port);
    seedCm(port);

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'set-active-tab',
      tab: 'groups',
      origin: TEST_ORIGIN,
    });
  });

  it('preserves the Pending selection across a round-trip to the Groups tab', async () => {
    await mountApp(port);
    seedCm(port);

    fireEvent.click(screen.getByRole('button', { name: 'Pending' }));
    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));

    // Groups reads Pending as "All" — grouped accordion shows, no empty state flash.
    expect(screen.getByText('g·3')).toBeInTheDocument();
    expect(screen.queryByText('No pending changes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Operators' }));

    expect(screen.getByRole('button', { name: 'Pending' })).toHaveClass('active');
  });
});
