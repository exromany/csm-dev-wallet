/**
 * QA-only key storage. Keys are stored in chrome.storage.session
 * (cleared when the browser closes). NEVER import real private keys.
 */

import type { Address, Hex } from 'viem';

const STORAGE_KEY = 'private_keys';

type KeyMap = Record<string, Hex>; // lowercase address → private key

async function getKeyMap(): Promise<KeyMap> {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as KeyMap | undefined) ?? {};
}

export async function getKey(address: Address): Promise<Hex | null> {
  const keys = await getKeyMap();
  return keys[address.toLowerCase()] ?? null;
}

export async function setKey(address: Address, privateKey: Hex): Promise<void> {
  const keys = await getKeyMap();
  keys[address.toLowerCase()] = privateKey;
  await chrome.storage.session.set({ [STORAGE_KEY]: keys });
}

export async function removeKey(address: Address): Promise<void> {
  const keys = await getKeyMap();
  delete keys[address.toLowerCase()];
  await chrome.storage.session.set({ [STORAGE_KEY]: keys });
}

export async function hasKey(address: Address): Promise<boolean> {
  const key = await getKey(address);
  return key !== null;
}
