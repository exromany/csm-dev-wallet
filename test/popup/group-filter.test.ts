import { describe, it, expect } from 'vitest';
import { filterByGroup } from '../../lib/popup/hooks.js';
import { makeOperator, ADDR_A, ADDR_B } from '../fixtures.js';

const op1 = makeOperator({ id: '1' });
const op2 = makeOperator({ id: '2', proposedManagerAddress: ADDR_B });
const op3 = makeOperator({ id: '3', proposedRewardsAddress: ADDR_A });
const op4 = makeOperator({
  id: '4',
  proposedManagerAddress: ADDR_A,
  proposedRewardsAddress: ADDR_B,
});
const ops = [op1, op2, op3, op4];

const neverFav = () => false;
const favSet = (ids: string[]) => (id: string) => ids.includes(id);

describe('filterByGroup', () => {
  it('returns all operators when group is "all"', () => {
    expect(filterByGroup(ops, 'all', neverFav)).toEqual(ops);
  });

  it('ignores favorites/pending state when group is "all"', () => {
    expect(filterByGroup(ops, 'all', favSet(['1']))).toEqual(ops);
  });

  it('returns only favorited operators when group is "favorites"', () => {
    const result = filterByGroup(ops, 'favorites', favSet(['2', '4']));
    expect(result.map((o) => o.id)).toEqual(['2', '4']);
  });

  it('returns empty when group is "favorites" and none favorited', () => {
    expect(filterByGroup(ops, 'favorites', neverFav)).toEqual([]);
  });

  it('returns operators with a proposed manager address when group is "pending"', () => {
    const result = filterByGroup([op1, op2], 'pending', neverFav);
    expect(result).toEqual([op2]);
  });

  it('returns operators with a proposed rewards address when group is "pending"', () => {
    const result = filterByGroup([op1, op3], 'pending', neverFav);
    expect(result).toEqual([op3]);
  });

  it('returns operators with either pending role when group is "pending"', () => {
    const result = filterByGroup(ops, 'pending', neverFav);
    expect(result.map((o) => o.id)).toEqual(['2', '3', '4']);
  });

  it('excludes operators with no pending role when group is "pending"', () => {
    expect(filterByGroup([op1], 'pending', neverFav)).toEqual([]);
  });

  it('pending filter does not consult isFavorite', () => {
    const result = filterByGroup(ops, 'pending', favSet(['1']));
    expect(result.map((o) => o.id)).toEqual(['2', '3', '4']);
  });
});
