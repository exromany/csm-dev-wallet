import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { truncateAddress, formatTimeAgo } from '../../lib/popup/utils.js';

describe('truncateAddress', () => {
  it('keeps first 6 and last 4 chars', () => {
    expect(truncateAddress('0xAbCdEfGh12345678901234567890AbCdEfGh1234'))
      .toBe('0xAbCd...1234');
  });
});

describe('formatTimeAgo', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns "just now" for < 60s', () => {
    vi.setSystemTime(10_000);
    expect(formatTimeAgo(10_000)).toBe('just now');
    expect(formatTimeAgo(10_000 - 59_000)).toBe('just now');
  });

  it('returns minutes for < 60m', () => {
    vi.setSystemTime(600_000);
    expect(formatTimeAgo(600_000 - 120_000)).toBe('2m ago');
  });

  it('returns hours for >= 60m', () => {
    vi.setSystemTime(7_200_000);
    expect(formatTimeAgo(0)).toBe('2h ago');
  });
});
