import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFavorites } from '../../lib/popup/hooks.js';
import { makeState } from '../fixtures.js';

describe('useFavorites', () => {
  it('isFavorite returns true for matching scoped key', () => {
    const state = makeState({
      chainId: 1,
      moduleType: 'csm',
      favorites: ['csm:1:42'],
    });
    const send = vi.fn();

    const { result } = renderHook(() => useFavorites(state, send));
    expect(result.current.isFavorite('42')).toBe(true);
  });

  it('isFavorite returns false for different chainId', () => {
    const state = makeState({
      chainId: 560048,
      moduleType: 'csm',
      favorites: ['csm:1:42'],
    });
    const send = vi.fn();

    const { result } = renderHook(() => useFavorites(state, send));
    expect(result.current.isFavorite('42')).toBe(false);
  });

  it('isFavorite returns false for different moduleType', () => {
    const state = makeState({
      chainId: 1,
      moduleType: 'cm',
      favorites: ['csm:1:42'],
    });
    const send = vi.fn();

    const { result } = renderHook(() => useFavorites(state, send));
    expect(result.current.isFavorite('42')).toBe(false);
  });

  it('toggle sends toggle-favorite command', () => {
    const state = makeState({ chainId: 1, moduleType: 'csm', favorites: [] });
    const send = vi.fn();

    const { result } = renderHook(() => useFavorites(state, send));
    act(() => result.current.toggle('42'));

    expect(send).toHaveBeenCalledWith({
      type: 'toggle-favorite',
      operatorId: '42',
    });
  });

  it('isFavorite returns false after favorite removed from state', () => {
    const send = vi.fn();
    const { result, rerender } = renderHook(
      ({ state }) => useFavorites(state, send),
      { initialProps: { state: makeState({ chainId: 1, moduleType: 'csm', favorites: ['csm:1:42'] }) } },
    );

    expect(result.current.isFavorite('42')).toBe(true);

    rerender({ state: makeState({ chainId: 1, moduleType: 'csm', favorites: [] }) });
    expect(result.current.isFavorite('42')).toBe(false);
  });

  it('multiple favorites: only matching IDs return true', () => {
    const state = makeState({
      chainId: 1,
      moduleType: 'csm',
      favorites: ['csm:1:1', 'csm:1:3'],
    });
    const send = vi.fn();

    const { result } = renderHook(() => useFavorites(state, send));
    expect(result.current.isFavorite('1')).toBe(true);
    expect(result.current.isFavorite('2')).toBe(false);
    expect(result.current.isFavorite('3')).toBe(true);
  });
});
