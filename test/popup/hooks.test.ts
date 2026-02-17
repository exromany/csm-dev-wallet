import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWalletState, useOperators } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeOperator, makeState } from '../fixtures.js';
import type { PopupEvent } from '../../lib/shared/messages.js';

describe('useWalletState — error handling', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
    vi.mocked(chrome.runtime.connect).mockReturnValue(port as unknown as chrome.runtime.Port);
  });

  it('starts with no error', () => {
    const { result } = renderHook(() => useWalletState());
    expect(result.current.error).toBeNull();
  });

  it('sets error on error event', () => {
    const { result } = renderHook(() => useWalletState());

    act(() => {
      port._emit({ type: 'error', message: 'Invalid RPC URL' } satisfies PopupEvent);
    });

    expect(result.current.error).toBe('Invalid RPC URL');
  });

  it('clears error on state-update', () => {
    const { result } = renderHook(() => useWalletState());

    act(() => {
      port._emit({ type: 'error', message: 'some error' } satisfies PopupEvent);
    });
    expect(result.current.error).toBe('some error');

    act(() => {
      port._emit({ type: 'state-update', state: makeState() } satisfies PopupEvent);
    });
    expect(result.current.error).toBeNull();
  });

  it('clearError resets error to null', () => {
    const { result } = renderHook(() => useWalletState());

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

describe('useOperators — network switch', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  it('starts with empty operators', () => {
    const { result } = renderHook(() =>
      useOperators(port as unknown as chrome.runtime.Port, 1, 'csm'),
    );
    expect(result.current.operators).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it('populates operators on matching event', () => {
    const { result } = renderHook(() =>
      useOperators(port as unknown as chrome.runtime.Port, 1, 'csm'),
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
        useOperators(port as unknown as chrome.runtime.Port, chainId, 'csm'),
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
        useOperators(port as unknown as chrome.runtime.Port, chainId, 'csm'),
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
        useOperators(port as unknown as chrome.runtime.Port, chainId, 'csm'),
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
        useOperators(port as unknown as chrome.runtime.Port, chainId, 'csm'),
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
