import { describe, it, expect } from 'vitest';
import { toggleFavorite } from '../../lib/shared/favorites.js';

describe('toggleFavorite', () => {
  it('adds favorite when absent', () => {
    const result = toggleFavorite([], 'csm', 1, '42');
    expect(result).toEqual(['csm:1:42']);
  });

  it('removes favorite when present', () => {
    const result = toggleFavorite(['csm:1:42'], 'csm', 1, '42');
    expect(result).toEqual([]);
  });

  it('preserves other favorites', () => {
    const result = toggleFavorite(['csm:1:1', 'csm:1:42'], 'csm', 1, '42');
    expect(result).toEqual(['csm:1:1']);
  });

  it('scopes to current module+chain', () => {
    const existing = ['csm:1:42'];
    const result = toggleFavorite(existing, 'cm', 560048, '5');
    expect(result).toEqual(['csm:1:42', 'cm:560048:5']);
  });
});
