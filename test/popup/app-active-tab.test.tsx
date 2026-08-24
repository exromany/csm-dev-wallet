import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

// chrome.tabs.query (test/setup) resolves the active tab to stake.lido.fi, so
// every command the popup sends carries this origin.
const TEST_ORIGIN = 'https://stake.lido.fi';
const ANVIL = 31337;

/** Render App and flush the origin-resolution + port-connect effects. */
async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

function tab(name: 'Operators' | 'Groups' | 'Shared' | 'Manual' | 'Anvil') {
  return screen.getByRole('button', { name });
}

describe('App — active tab persistence', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  it('restores the persisted tab on open (Manual)', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState({ activeTab: 'manual' }) } satisfies PopupEvent);
    });

    expect(tab('Manual')).toHaveClass('active');
    expect(tab('Operators')).not.toHaveClass('active');
  });

  it('restores the persisted Anvil tab when the site is on Anvil', async () => {
    await mountApp(port);

    act(() => {
      port._emit({
        type: 'state-update',
        state: makeState({ chainId: ANVIL, activeTab: 'anvil' }),
      } satisfies PopupEvent);
    });

    expect(tab('Anvil')).toHaveClass('active');
  });

  it('falls back to Operators when the persisted tab is Anvil but the site left Anvil', async () => {
    await mountApp(port);

    // Persisted choice is anvil, but the site is on mainnet — the Anvil tab
    // does not exist there, so the derive downgrades to operators.
    act(() => {
      port._emit({
        type: 'state-update',
        state: makeState({ chainId: 1, activeTab: 'anvil' }),
      } satisfies PopupEvent);
    });

    expect(screen.queryByRole('button', { name: 'Anvil' })).toBeNull();
    expect(tab('Operators')).toHaveClass('active');
  });

  it('persists the tab to per-site state on click', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState() } satisfies PopupEvent);
    });

    fireEvent.click(tab('Manual'));

    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'set-active-tab',
      tab: 'manual',
      origin: TEST_ORIGIN,
    });
  });

  it('switches locally without waiting for a service-worker round-trip', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ activeTab: 'operators' }) } satisfies PopupEvent);
    });

    // No follow-up state-update is emitted — the tab must flip purely from local state.
    fireEvent.click(tab('Manual'));

    expect(tab('Manual')).toHaveClass('active');
    expect(tab('Operators')).not.toHaveClass('active');
  });

  it('does NOT persist when opening Settings', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState() } satisfies PopupEvent);
    });
    port.postMessage.mockClear();

    fireEvent.click(screen.getByTitle('Settings'));

    // Settings is shown locally…
    expect(document.querySelector('.settings-group')).toBeTruthy();
    // …but the choice never reaches the service worker, so reopen won't land here.
    expect(port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'set-active-tab' }),
    );
  });

  it('renders a Shared tab and keeps Settings out of the tab bar', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState() } satisfies PopupEvent);
    });

    const tabLabels = [...document.querySelectorAll('button.tab')].map((el) => el.textContent);
    expect(tabLabels).toContain('Shared');
    expect(tabLabels).not.toContain('Settings');

    // Settings is reachable from the header instead.
    expect(document.querySelector('.icon-btn[title="Settings"]')).toBeTruthy();
  });

  it('restores the persisted Shared tab on open', async () => {
    await mountApp(port);

    act(() => {
      port._emit({
        type: 'state-update',
        state: makeState({ activeTab: 'shared' }),
      } satisfies PopupEvent);
    });

    expect(tab('Shared')).toHaveClass('active');
    expect(tab('Operators')).not.toHaveClass('active');
  });
});

describe('App — Groups tab', () => {
  let port: MockPort;
  beforeEach(() => { port = createMockPort(); });

  it('shows the Groups tab right after Operators when the module is CM', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'cm' }) } satisfies PopupEvent);
    });

    const tabs = screen.getAllByRole('button').filter((b) =>
      ['Operators', 'Groups', 'Shared', 'Manual'].includes(b.textContent ?? ''),
    );
    expect(tabs.map((b) => b.textContent)).toEqual(['Operators', 'Groups', 'Shared', 'Manual']);
  });

  it('hides the Groups tab for CSM', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm' }) } satisfies PopupEvent);
    });
    expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
  });

  it('falls back to Operators when the persisted tab is Groups but the module is CSM', async () => {
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm', activeTab: 'groups' }) } satisfies PopupEvent);
    });
    expect(screen.queryByRole('button', { name: 'Groups' })).toBeNull();
    expect(tab('Operators')).toHaveClass('active');
  });
});
