import type { ModuleType } from './types.js';

/** Build scoped favorite key: "module:chainId:operatorId" */
export function favKey(moduleType: ModuleType, chainId: number, operatorId: string): string {
  return `${moduleType}:${chainId}:${operatorId}`;
}

/** Toggle a favorite — returns new array (add if absent, remove if present) */
export function toggleFavorite(
  favorites: string[],
  moduleType: ModuleType,
  chainId: number,
  operatorId: string,
): string[] {
  const key = favKey(moduleType, chainId, operatorId);
  return favorites.includes(key)
    ? favorites.filter((id) => id !== key)
    : [...favorites, key];
}
