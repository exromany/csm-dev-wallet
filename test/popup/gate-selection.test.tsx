import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState, ADDR_C } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

const ICS_GATE = { gate: 'icsGate', label: 'ICS', curveId: '2', operatorType: 'CSM_ICS', paused: false, unconsumed: [ADDR_C], leafCount: 3 };
const CM_GATE = { gate: 'cmGate', label: 'PTO', curveId: '1', operatorType: 'CM_PTO', paused: false, unconsumed: [ADDR_C], leafCount: 2 };

async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

function selectCalls(port: MockPort) {
  return port.postMessage.mock.calls
    .map(([msg]) => msg)
    .filter((msg) => msg.type === 'select-address');
}

describe('App — gate selection', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  it('selects a gate proof from the Shared tab', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState({ activeTab: 'shared' }) } satisfies PopupEvent);
      port._emit({ type: 'module-availability', modules: { csm: true, cm: false, csm02: false } } satisfies PopupEvent);
    });
    // request-operators/request-gates listeners are wired by an effect that only
    // runs once `resolved`+`enabled` settle above, so the updates need a later tick.
    act(() => {
      port._emit({ type: 'operators-update', chainId: 1, moduleType: 'csm', operators: [], lastFetchedAt: 1 } satisfies PopupEvent);
      port._emit({ type: 'gates-update', chainId: 1, moduleType: 'csm', gates: [ICS_GATE], lastFetchedAt: 1 } satisfies PopupEvent);
    });

    fireEvent.click(screen.getByText('Gate'));
    fireEvent.click(document.querySelector('.addr-head')!);
    fireEvent.click(document.querySelector('.attach-row.gate')!);

    expect(selectCalls(port)).toContainEqual(
      expect.objectContaining({ type: 'select-address', address: ADDR_C, source: { type: 'gate', gate: 'icsGate' } }),
    );
  });

  it('includes moduleType for a gate from a non-site module, selected from the connected bar', async () => {
    await mountApp(port);

    act(() => {
      port._emit({
        type: 'state-update',
        state: makeState({ selectedAddress: { address: ADDR_C, source: { type: 'manual' } } }),
      } satisfies PopupEvent);
      port._emit({ type: 'module-availability', modules: { csm: true, cm: true, csm02: false } } satisfies PopupEvent);
    });
    act(() => {
      port._emit({ type: 'operators-update', chainId: 1, moduleType: 'csm', operators: [], lastFetchedAt: 1 } satisfies PopupEvent);
      port._emit({ type: 'operators-update', chainId: 1, moduleType: 'cm', operators: [], lastFetchedAt: 1 } satisfies PopupEvent);
      port._emit({ type: 'gates-update', chainId: 1, moduleType: 'csm', gates: [], lastFetchedAt: 1 } satisfies PopupEvent);
      port._emit({ type: 'gates-update', chainId: 1, moduleType: 'cm', gates: [CM_GATE], lastFetchedAt: 1 } satisfies PopupEvent);
    });

    fireEvent.click(document.querySelector('.ops-pop .attach-row.gate')!);

    expect(selectCalls(port)).toContainEqual(
      expect.objectContaining({
        type: 'select-address',
        address: ADDR_C,
        source: { type: 'gate', gate: 'cmGate' },
        moduleType: 'cm',
      }),
    );
  });
});
