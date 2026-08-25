import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { App } from '../../entrypoints/popup/App.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeState } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

async function mountApp(port: MockPort) {
  vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  render(<App />);
  await act(async () => {});
}

function switchedModules(port: MockPort) {
  return port.postMessage.mock.calls
    .map(([msg]) => msg)
    .filter((msg) => msg.type === 'switch-module')
    .map((msg) => msg.moduleType);
}

describe('App — falls back to CSM when the selected module is unavailable', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  it('switches away from CSM 0x02 on a network without it', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm02' }) } satisfies PopupEvent);
      port._emit({
        type: 'module-availability',
        modules: { csm: true, cm: true, csm02: false },
      } satisfies PopupEvent);
    });

    expect(switchedModules(port)).toContain('csm');
  });

  it('switches away from CM on a network without it', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'cm' }) } satisfies PopupEvent);
      port._emit({
        type: 'module-availability',
        modules: { csm: true, cm: false, csm02: true },
      } satisfies PopupEvent);
    });

    expect(switchedModules(port)).toContain('csm');
  });

  it('keeps CSM 0x02 selected while it is available', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm02' }) } satisfies PopupEvent);
      port._emit({
        type: 'module-availability',
        modules: { csm: true, cm: true, csm02: true },
      } satisfies PopupEvent);
    });

    expect(switchedModules(port)).toEqual([]);
  });

  it('keeps the selection while availability is still unknown', async () => {
    await mountApp(port);

    act(() => {
      port._emit({ type: 'state-update', state: makeState({ moduleType: 'csm02' }) } satisfies PopupEvent);
    });

    expect(switchedModules(port)).toEqual([]);
  });
});
