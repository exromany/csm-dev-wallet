import { describe, it, expect } from 'vitest';
import { filterOperators } from '../../lib/popup/hooks.js';
import { makeOperator, ADDR_A, ADDR_B } from '../fixtures.js';

describe('filterOperators with addressLabels', () => {
  const ops = [
    makeOperator({ id: '1', managerAddress: ADDR_A, rewardsAddress: ADDR_B }),
    makeOperator({ id: '2', managerAddress: ADDR_B, rewardsAddress: ADDR_A }),
  ];

  it('matches label on manager address', () => {
    const labels = { [ADDR_A.toLowerCase()]: 'Alice' };
    const result = filterOperators(ops, 'alice', labels);
    expect(result.map((o) => o.id)).toEqual(['1', '2']);
  });

  it('matches label on rewards address', () => {
    const labels = { [ADDR_B.toLowerCase()]: 'Bob' };
    const result = filterOperators(ops, 'bob', labels);
    expect(result.map((o) => o.id)).toEqual(['1', '2']);
  });

  it('does not match when label is on a different address', () => {
    const labels = { '0x0000000000000000000000000000000000000000': 'Charlie' };
    const result = filterOperators(ops, 'charlie', labels);
    expect(result).toEqual([]);
  });

  it('still matches by address hex without labels', () => {
    const result = filterOperators(ops, ADDR_A.slice(0, 6));
    expect(result.length).toBeGreaterThan(0);
  });

  it('works with empty labels object', () => {
    const result = filterOperators(ops, '1', {});
    expect(result.map((o) => o.id)).toEqual(['1']);
  });
});
