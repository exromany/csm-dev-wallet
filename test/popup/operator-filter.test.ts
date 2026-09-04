import { describe, it, expect } from 'vitest';
import { filterOperators } from '../../lib/popup/hooks.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C, ADDR_D } from '../fixtures.js';

const ops = [
  makeOperator({ id: '1', managerAddress: ADDR_A, rewardsAddress: ADDR_B, operatorType: 'CSM_DEF' }),
  makeOperator({ id: '10', managerAddress: ADDR_B, rewardsAddress: ADDR_C, operatorType: 'CSM_LEA' }),
  makeOperator({
    id: '21',
    managerAddress: ADDR_C,
    rewardsAddress: ADDR_A,
    operatorType: 'CSM_DEF',
    proposedManagerAddress: ADDR_B,
    proposedRewardsAddress: ADDR_A,
    claimerAddress: ADDR_D,
  }),
];

describe('filterOperators', () => {
  it('returns all when search is empty', () => {
    expect(filterOperators(ops, '')).toEqual(ops);
  });

  it('returns all when search is whitespace', () => {
    expect(filterOperators(ops, '   ')).toEqual(ops);
  });

  // #N exact ID match
  it('#1 matches only operator 1 (exact)', () => {
    const result = filterOperators(ops, '#1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('#10 matches only operator 10', () => {
    const result = filterOperators(ops, '#10');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('10');
  });

  it('#99 matches nothing', () => {
    expect(filterOperators(ops, '#99')).toHaveLength(0);
  });

  // bare number → substring match on id
  it('bare "1" matches ids containing "1" (1, 10, 21)', () => {
    const result = filterOperators(ops, '1');
    expect(result.map((o) => o.id).sort()).toEqual(['1', '10', '21']);
  });

  it('bare "21" matches only id 21', () => {
    const result = filterOperators(ops, '21');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('21');
  });

  // address search
  it('filters by manager address substring', () => {
    const q = ADDR_A.slice(2, 8).toLowerCase();
    const result = filterOperators(ops, q);
    expect(result.map((o) => o.id)).toContain('1');
  });

  it('filters by rewards address substring', () => {
    const q = ADDR_C.slice(2, 8).toLowerCase();
    const result = filterOperators(ops, q);
    expect(result.map((o) => o.id)).toContain('10');
  });

  it('filters by proposedManagerAddress', () => {
    const q = ADDR_B.slice(2, 8).toLowerCase();
    const result = filterOperators(ops, q);
    expect(result.map((o) => o.id)).toContain('21');
  });

  it('filters by proposedRewardsAddress', () => {
    const q = ADDR_A.slice(2, 8).toLowerCase();
    const result = filterOperators(ops, q);
    expect(result.map((o) => o.id)).toContain('21');
  });

  it('filters by claimerAddress', () => {
    const q = ADDR_D.slice(2, 8).toLowerCase();
    const result = filterOperators(ops, q);
    expect(result.map((o) => o.id)).toEqual(['21']);
  });

  // operatorType search
  it('filters by operatorType (case-insensitive)', () => {
    const result = filterOperators(ops, 'lea');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('10');
  });

  it('filters by operatorType partial match', () => {
    const result = filterOperators(ops, 'def');
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id).sort()).toEqual(['1', '21']);
  });

  // operator label search
  it('filters by operator label (the new per-operator nickname)', () => {
    const labels: Record<string, string> = { '1': 'Kiln', '10': 'P2P.org' };
    const getLabel = (id: string) => labels[id] ?? '';

    const result = filterOperators(ops, 'kiln', {}, getLabel);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('operator-label search is case-insensitive and substring', () => {
    const labels: Record<string, string> = { '1': 'Kiln', '10': 'P2P.org' };
    const getLabel = (id: string) => labels[id] ?? '';

    expect(filterOperators(ops, 'p2p', {}, getLabel).map((o) => o.id)).toEqual(['10']);
    expect(filterOperators(ops, 'KIL', {}, getLabel).map((o) => o.id)).toEqual(['1']);
  });

  it('operator-label search does not affect id-substring matches', () => {
    const labels: Record<string, string> = { '1': '21-banger' };
    const getLabel = (id: string) => labels[id] ?? '';

    // '21' still matches operator 21 by id; operator 1 ALSO matches by label.
    const result = filterOperators(ops, '21', {}, getLabel);
    expect(result.map((o) => o.id).sort()).toEqual(['1', '21']);
  });
});
