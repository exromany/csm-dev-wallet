import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOperatorLabels } from '../../lib/popup/hooks.js';
import { makeState } from '../fixtures.js';

describe('useOperatorLabels', () => {
  it('get with no module returns the site-module-scoped label', () => {
    const state = makeState({
      chainId: 1,
      moduleType: 'csm',
      operatorLabels: { 'csm:1:7': 'Kiln' },
    });
    const send = vi.fn();

    const { result } = renderHook(() => useOperatorLabels(state, send));
    expect(result.current.get('7')).toBe('Kiln');
  });

  it('get with explicit module reads that module key while site is on another module', () => {
    const state = makeState({
      chainId: 1,
      moduleType: 'csm',
      operatorLabels: { 'cm:1:7': 'P2P.org' },
    });
    const send = vi.fn();

    const { result } = renderHook(() => useOperatorLabels(state, send));
    expect(result.current.get('7', 'cm')).toBe('P2P.org');
    expect(result.current.get('7')).toBe('');
  });

  it('set with explicit module sends the command carrying moduleType', () => {
    const state = makeState({ chainId: 1, moduleType: 'csm' });
    const send = vi.fn();

    const { result } = renderHook(() => useOperatorLabels(state, send));
    act(() => result.current.set('7', 'x', 'cm'));

    expect(send).toHaveBeenCalledWith({
      type: 'set-operator-label',
      operatorId: '7',
      label: 'x',
      moduleType: 'cm',
    });
  });

  it('set with no override sends the command without moduleType', () => {
    const state = makeState({ chainId: 1, moduleType: 'csm' });
    const send = vi.fn();

    const { result } = renderHook(() => useOperatorLabels(state, send));
    act(() => result.current.set('7', 'x'));

    expect(send).toHaveBeenCalledWith({
      type: 'set-operator-label',
      operatorId: '7',
      label: 'x',
    });
  });
});
