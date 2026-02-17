import type { WalletState } from '../shared/types.js';
import { DEFAULT_WALLET_STATE } from '../shared/types.js';
import type { BroadcastMessage } from '../shared/messages.js';

const STORAGE_KEY = 'wallet_state';

// ── In-memory cache + write mutex ──

let cached: WalletState | null = null;
let writeLock: Promise<WalletState> = Promise.resolve(DEFAULT_WALLET_STATE);

/** Migrate legacy state to current shape — returns new object when changed */
function migrateState(raw: WalletState): { state: WalletState; changed: boolean } {
  let changed = false;
  let state = raw;

  // Add moduleType if missing (pre-v2 state)
  if (!state.moduleType) {
    state = { ...state, moduleType: 'csm' };
    changed = true;
  }

  // Migrate bare favorite IDs ("42") to scoped format ("csm:<chainId>:42")
  const migrated = state.favorites.map((fav) => {
    if (!fav.includes(':')) {
      changed = true;
      return `csm:${state.chainId}:${fav}`;
    }
    return fav;
  });

  if (changed) {
    state = { ...state, favorites: migrated };
  }

  return { state, changed };
}

export async function getState(): Promise<WalletState> {
  if (cached) return cached;

  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = (data[STORAGE_KEY] as WalletState | undefined) ?? { ...DEFAULT_WALLET_STATE };
  const { state, changed } = migrateState(raw);

  if (changed || !data[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  cached = state;
  return state;
}

export async function setState(
  update: Partial<WalletState>,
): Promise<WalletState> {
  const result = writeLock.then(async () => {
    const current = await getState();
    const next = { ...current, ...update };
    cached = next;
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
  // On failure, reset lock to current state so subsequent calls aren't stuck
  writeLock = result.catch(() => getState());
  return result;
}

/** Broadcast state change to all content scripts */
export async function broadcastToTabs(message: BroadcastMessage) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab may not have content script — ignore
      });
    }
  }
}

/** Notify accounts changed to all tabs */
export async function notifyAccountsChanged(accounts: string[]) {
  await broadcastToTabs({
    type: 'state-changed',
    event: 'accountsChanged',
    data: accounts,
  });
}

/** Notify chain changed to all tabs */
export async function notifyChainChanged(chainId: number) {
  await broadcastToTabs({
    type: 'state-changed',
    event: 'chainChanged',
    data: `0x${chainId.toString(16)}`,
  });
}
