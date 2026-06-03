import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWalletState, useOperators, useModuleAvailability } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeOperator, makeState } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

const TEST_ORIGIN = 'https://stake.lido.fi';

describe('useWalletState — error handling', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
    vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  });

  it('starts with no error', async () => {
    const { result } = renderHook(() => useWalletState());

    // Wait for origin resolution to trigger port connection
    await act(async () => {});

    expect(result.current.error).toBeNull();
  });

  it('sets error on error event', async () => {
    const { result } = renderHook(() => useWalletState());
    await act(async () => {});

    act(() => {
      port._emit({ type: 'error', message: 'Invalid RPC URL' } satisfies PopupEvent);
    });

    expect(result.current.error).toBe('Invalid RPC URL');
  });

  it('clears error on state-update', async () => {
    const { result } = renderHook(() => useWalletState());
    await act(async () => {});

    act(() => {
      port._emit({ type: 'error', message: 'some error' } satisfies PopupEvent);
    });
    expect(result.current.error).toBe('some error');

    act(() => {
      port._emit({ type: 'state-update', state: makeState() } satisfies PopupEvent);
    });
    expect(result.current.error).toBeNull();
  });

  it('clearError resets error to null', async () => {
    const { result } = renderHook(() => useWalletState());
    await act(async () => {});

    act(() => {
      port._emit({ type: 'error', message: 'bad' } satisfies PopupEvent);
    });
    expect(result.current.error).toBe('bad');

    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });
});

describe('useWalletState — reconnect on disconnect', () => {
  let port1: MockPort;
  let port2: MockPort;

  beforeEach(() => {
    port1 = createMockPort();
    port2 = createMockPort();
    vi.mocked(chrome.runtime.connect).mockClear();
    let callCount = 0;
    vi.mocked(chrome.runtime.connect).mockImplementation(() => {
      const p = callCount++ === 0 ? port1 : port2;
      return p as unknown as chrome.runtime.Port;
    });
  });

  it('reopens port when SW disconnects and window regains focus', async () => {
    const { result } = renderHook(() => useWalletState());
    await act(async () => {});

    expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    expect(result.current.port).toBe(port1 as unknown as chrome.runtime.Port);

    // SW idles out: Chrome fires onDisconnect on the popup port
    act(() => {
      port1._emitDisconnect();
    });
    expect(result.current.port).toBeNull();

    // Popup regains focus → reconnect handler opens a new port and resends get-state
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
    expect(result.current.port).toBe(port2 as unknown as chrome.runtime.Port);
    expect(port2.postMessage).toHaveBeenCalledWith({
      type: 'get-state',
      origin: TEST_ORIGIN,
    });
  });

  it('send silently clears port when postMessage throws on a dead port', async () => {
    const { result } = renderHook(() => useWalletState());
    await act(async () => {});

    // get-state has already gone out; make the next postMessage throw, simulating
    // the SW dying between React render and click handler.
    port1.postMessage.mockImplementationOnce(() => {
      throw new Error('Attempting to use a disconnected port object');
    });

    act(() => {
      result.current.send({ type: 'switch-module', moduleType: 'csm' });
    });

    expect(result.current.port).toBeNull();
  });
});

describe('useOperators — network switch', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  it('starts with empty operators', () => {
    const { result } = renderHook(() =>
      useOperators(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, 'csm'),
    );
    expect(result.current.operators).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it('populates operators on matching event', () => {
    const { result } = renderHook(() =>
      useOperators(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, 'csm'),
    );

    const ops = [makeOperator({ id: '1' }), makeOperator({ id: '2' })];
    act(() => {
      port._emit({
        type: 'operators-update',
        chainId: 1,
        moduleType: 'csm',
        operators: ops,
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });

    expect(result.current.operators).toHaveLength(2);
  });

  it('resets operators on chainId change', () => {
    const { result, rerender } = renderHook(
      ({ chainId }) =>
        useOperators(port as unknown as chrome.runtime.Port, TEST_ORIGIN, chainId, 'csm'),
      { initialProps: { chainId: 1 } },
    );

    // Populate chain 1
    act(() => {
      port._emit({
        type: 'operators-update',
        chainId: 1,
        moduleType: 'csm',
        operators: [makeOperator({ id: '1' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });
    expect(result.current.operators).toHaveLength(1);

    // Switch to chain 560048
    rerender({ chainId: 560048 });
    expect(result.current.operators).toEqual([]);
  });

  it('ignores events for old chainId after switch', () => {
    const { result, rerender } = renderHook(
      ({ chainId }) =>
        useOperators(port as unknown as chrome.runtime.Port, TEST_ORIGIN, chainId, 'csm'),
      { initialProps: { chainId: 1 } },
    );

    // Switch to 560048
    rerender({ chainId: 560048 });

    // Stale event for chain 1
    act(() => {
      port._emit({
        type: 'operators-update',
        chainId: 1,
        moduleType: 'csm',
        operators: [makeOperator({ id: '99' })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
    });

    expect(result.current.operators).toEqual([]);
  });

  it('accepts events for new chainId after switch', () => {
    const { result, rerender } = renderHook(
      ({ chainId }) =>
        useOperators(port as unknown as chrome.runtime.Port, TEST_ORIGIN, chainId, 'csm'),
      { initialProps: { chainId: 1 } },
    );

    rerender({ chainId: 560048 });

    act(() => {
      port._emit({
        type: 'operators-update',
        chainId: 560048,
        moduleType: 'csm',
        operators: [makeOperator({ id: '5' })],
        lastFetchedAt: 3000,
      } satisfies PopupEvent);
    });

    expect(result.current.operators).toHaveLength(1);
    expect(result.current.operators[0].id).toBe('5');
  });

  it('resets again when switching back to original chainId', () => {
    const { result, rerender } = renderHook(
      ({ chainId }) =>
        useOperators(port as unknown as chrome.runtime.Port, TEST_ORIGIN, chainId, 'csm'),
      { initialProps: { chainId: 1 } },
    );

    // Populate chain 1
    act(() => {
      port._emit({
        type: 'operators-update',
        chainId: 1,
        moduleType: 'csm',
        operators: [makeOperator({ id: '1' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });

    // Switch away and back
    rerender({ chainId: 560048 });
    rerender({ chainId: 1 });

    // Should be reset
    expect(result.current.operators).toEqual([]);

    // Re-populate
    act(() => {
      port._emit({
        type: 'operators-update',
        chainId: 1,
        moduleType: 'csm',
        operators: [makeOperator({ id: '1' }), makeOperator({ id: '2' })],
        lastFetchedAt: 4000,
      } satisfies PopupEvent);
    });

    expect(result.current.operators).toHaveLength(2);
  });
});

describe('useModuleAvailability', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  it('starts with empty availability', () => {
    const { result } = renderHook(() =>
      useModuleAvailability(port as unknown as chrome.runtime.Port),
    );
    expect(result.current).toEqual({});
  });

  it('updates on module-availability event', () => {
    const { result } = renderHook(() =>
      useModuleAvailability(port as unknown as chrome.runtime.Port),
    );

    act(() => {
      port._emit({
        type: 'module-availability',
        modules: { csm: true, cm: true },
      } satisfies PopupEvent);
    });

    expect(result.current).toEqual({ csm: true, cm: true });
  });

  it('does not report cm as false before availability is known', () => {
    const { result } = renderHook(() =>
      useModuleAvailability(port as unknown as chrome.runtime.Port),
    );

    // Before any event, cm should be undefined — not false.
    // This prevents the auto-switch effect from resetting a persisted CM selection.
    expect(result.current.cm).toBeUndefined();
  });
});
