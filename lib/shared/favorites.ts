import type { ModuleType } from './types.js';

/** Build scoped favorite key: "module:chainId:id" — same shape for operator and group ids */
export function favKey(moduleType: ModuleType, chainId: number, id: string): string {
  return `${moduleType}:${chainId}:${id}`;
}

/** Toggle a favorite — returns new array (add if absent, remove if present) */
export function toggleFavorite(
  favorites: string[],
  moduleType: ModuleType,
  chainId: number,
  id: string,
): string[] {
  const key = favKey(moduleType, chainId, id);
  return favorites.includes(key)
    ? favorites.filter((k) => k !== key)
    : [...favorites, key];
}
