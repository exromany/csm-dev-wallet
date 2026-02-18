import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopyAddress } from '../../lib/popup/hooks.js';

describe('useCopyAddress', () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
    writeText.mockClear();
  });

  it('calls navigator.clipboard.writeText with full address', async () => {
    const { result } = renderHook(() => useCopyAddress());

    await act(async () => result.current.copy('0xAbCd1234'));

    expect(writeText).toHaveBeenCalledWith('0xAbCd1234');
  });

  it('isCopied returns true for the copied address (case-insensitive)', async () => {
    const { result } = renderHook(() => useCopyAddress());

    await act(async () => result.current.copy('0xAbCd1234'));

    expect(result.current.isCopied('0xabcd1234')).toBe(true);
    expect(result.current.isCopied('0xAbCd1234')).toBe(true);
  });

  it('isCopied returns false for a different address', async () => {
    const { result } = renderHook(() => useCopyAddress());

    await act(async () => result.current.copy('0xAAAA'));

    expect(result.current.isCopied('0xBBBB')).toBe(false);
  });

  it('isCopied reverts to false after 1500ms', async () => {
    const { result } = renderHook(() => useCopyAddress());

    await act(async () => result.current.copy('0xAAAA'));
    expect(result.current.isCopied('0xAAAA')).toBe(true);

    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.isCopied('0xAAAA')).toBe(false);
  });

  it('copying a new address replaces the previous one', async () => {
    const { result } = renderHook(() => useCopyAddress());

    await act(async () => result.current.copy('0xAAAA'));
    await act(async () => result.current.copy('0xBBBB'));

    expect(result.current.isCopied('0xAAAA')).toBe(false);
    expect(result.current.isCopied('0xBBBB')).toBe(true);
  });
});
