import { describe, it, expect } from 'vitest';
import { filterGroupedView } from '../../lib/popup/hooks.js';
import { groupOperators, groupLabel } from '../../lib/shared/groups.js';
import { makeOperator, ADDR_B, ADDR_D } from '../fixtures.js';

const og = (id: string, groupId?: string, groupName?: string, extras: Partial<ReturnType<typeof makeOperator>> = {}) =>
  makeOperator({ id, groupId, groupName, ...extras });

describe('groupOperators', () => {
  it('buckets operators by groupId, sorts groups by numeric id', () => {
    const ops = [
      og('1', '20', 'Stakely'),
      og('2'), // ungrouped
      og('3', '3', 'Kiln'),
      og('4', '20', 'Stakely'),
      og('5'), // ungrouped
      og('6', '3', 'Kiln'),
    ];
    const result = groupOperators(ops);
    expect(result.groups.map((g) => g.id)).toEqual(['3', '20']);
    expect(result.groups[0].operators.map((o) => o.id)).toEqual(['3', '6']);
    expect(result.groups[1].operators.map((o) => o.id)).toEqual(['1', '4']);
    expect(result.ungrouped.map((o) => o.id)).toEqual(['2', '5']);
  });

  it('keeps group name from the first operator that carries one', () => {
    const ops = [og('1', '7'), og('2', '7', 'Late Name')];
    const result = groupOperators(ops);
    expect(result.groups[0].name).toBe('Late Name');
  });
});

describe('groupLabel', () => {
  it('returns the on-chain name when present', () => {
    expect(groupLabel({ id: '3', name: 'Kiln', operators: [] })).toBe('Kiln');
  });
  it('falls back to "Group #<id>" when title is missing', () => {
    expect(groupLabel({ id: '7', operators: [] })).toBe('Group #7');
  });
});

describe('filterGroupedView', () => {
  const ops = [
    og('1', '3', 'Kiln'),
    og('2', '3', 'Kiln', { proposedManagerAddress: ADDR_B }),
    og('3', '20'),
    og('4'), // ungrouped
    og('5', undefined, undefined, { proposedRewardsAddress: ADDR_B }),
  ];
  const grouped = groupOperators(ops);

  it('"all" returns every group and all ungrouped', () => {
    const result = filterGroupedView(grouped, 'all', () => false);
    expect(result.groups.map((g) => g.group.id)).toEqual(['3', '20']);
    expect(result.ungrouped.map((o) => o.id)).toEqual(['4', '5']);
    expect(result.groups.every((g) => !g.partial)).toBe(true);
  });

  it('"favorites" returns only starred groups in full; hides "No group"', () => {
    const result = filterGroupedView(grouped, 'favorites', (id) => id === '3');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].group.id).toBe('3');
    expect(result.groups[0].group.operators).toHaveLength(2);
    expect(result.groups[0].partial).toBe(false);
    expect(result.ungrouped).toEqual([]);
  });

  it('"favorites" with no starred groups returns empty', () => {
    const result = filterGroupedView(grouped, 'favorites', () => false);
    expect(result.groups).toEqual([]);
    expect(result.ungrouped).toEqual([]);
  });

  it('"pending" returns only pending ops inside groups (partial), plus pending ungrouped', () => {
    const result = filterGroupedView(grouped, 'pending', () => false);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].group.id).toBe('3');
    expect(result.groups[0].group.operators.map((o) => o.id)).toEqual(['2']);
    expect(result.groups[0].partial).toBe(true);
    expect(result.ungrouped.map((o) => o.id)).toEqual(['5']);
  });

  it('"claimer" strips non-claimer members from a group (partial), plus claimer ungrouped', () => {
    const withClaimer = [
      og('1', '3', 'Kiln'),
      og('2', '3', 'Kiln', { claimerAddress: ADDR_D }),
      og('3', '20'),
      og('4'), // ungrouped
      og('5', undefined, undefined, { claimerAddress: ADDR_D }),
    ];
    const result = filterGroupedView(groupOperators(withClaimer), 'claimer', () => false);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].group.id).toBe('3');
    expect(result.groups[0].group.operators.map((o) => o.id)).toEqual(['2']);
    expect(result.groups[0].partial).toBe(true);
    expect(result.ungrouped.map((o) => o.id)).toEqual(['5']);
  });
});
