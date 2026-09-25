import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { truncateAddress, formatTimeAgo, feeSplitsHint } from '../../lib/popup/utils.js';
import { ADDR_A, ADDR_B } from '../fixtures.js';

describe('truncateAddress', () => {
  it('keeps first 6 and last 4 chars', () => {
    expect(truncateAddress('0xAbCdEfGh12345678901234567890AbCdEfGh1234'))
      .toBe('0xAbCd…1234');
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

describe('feeSplitsHint', () => {
  it('uses the singular "recipient" for one split, one line per recipient, and the keep line', () => {
    expect(feeSplitsHint([{ recipient: ADDR_A, share: '4000' }])).toBe(
      'Fee splits · 1 recipient\n0xaAaA…aaAa · 40.00%\nOperator keeps 60.00%',
    );
  });

  it('uses the plural "recipients" and lists every recipient in order', () => {
    expect(
      feeSplitsHint([
        { recipient: ADDR_A, share: '4000' },
        { recipient: ADDR_B, share: '2500' },
      ]),
    ).toBe(
      'Fee splits · 2 recipients\n0xaAaA…aaAa · 40.00%\n0xbBbB…BBbB · 25.00%\nOperator keeps 35.00%',
    );
  });

  it('floors the operator keep at 0 when shares meet or exceed MAX_BP', () => {
    expect(feeSplitsHint([{ recipient: ADDR_A, share: '10000' }])).toBe(
      'Fee splits · 1 recipient\n0xaAaA…aaAa · 100.00%\nOperator keeps 0.00%',
    );
    expect(feeSplitsHint([{ recipient: ADDR_A, share: '12000' }])).toContain(
      'Operator keeps 0.00%',
    );
  });
});
