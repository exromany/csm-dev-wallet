import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState, ADDR_A, ADDR_B } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';

async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

function selectCalls(port: MockPort) {
  return port.postMessage.mock.calls.map(([msg]) => msg).filter((msg) => msg.type === 'select-address');
}

describe('App — role holder selection', () => {
  let port: MockPort;

  beforeEach(async () => {
    port = createMockPort();
    await mountApp(port);
    act(() => {
      port._emit({ type: 'state-update', state: makeState({ activeTab: 'roles' }) } satisfies PopupEvent);
      port._emit({ type: 'module-availability', modules: { csm: true, cm: true, csm02: false } } satisfies PopupEvent);
    });
    act(() => {
      port._emit({
        type: 'roles-update', chainId: 1, moduleType: 'csm', lastFetchedAt: 1,
        roles: [{ role: PENALTY, holders: [{ address: ADDR_A, isContract: false }] }],
      } satisfies PopupEvent);
      port._emit({
        type: 'roles-update', chainId: 1, moduleType: 'cm', lastFetchedAt: 1,
        roles: [{ role: PENALTY, holders: [{ address: ADDR_B, isContract: true }] }],
      } satisfies PopupEvent);
    });
  });

  it('switches the site to the holder module when it differs', () => {
    fireEvent.click(document.querySelectorAll('.role-row')[1]!);
    expect(selectCalls(port)).toContainEqual(expect.objectContaining({
      type: 'select-address', address: ADDR_B, source: { type: 'role', role: PENALTY }, moduleType: 'cm',
    }));
  });

  it('omits moduleType for a holder on the site module', () => {
    fireEvent.click(document.querySelectorAll('.role-row')[0]!);
    const [call] = selectCalls(port);
    expect(call).toMatchObject({ address: ADDR_A, source: { type: 'role', role: PENALTY } });
    expect(call).not.toHaveProperty('moduleType');
  });
});
