import type { WalletState } from '../shared/types.js';
import { DEFAULT_WALLET_STATE } from '../shared/types.js';
import type { BroadcastMessage } from '../shared/messages.js';

const STORAGE_KEY = 'wallet_state';

/** Migrate legacy state to current shape */
function migrateState(raw: WalletState): WalletState {
  let changed = false;

  // Add moduleType if missing (pre-v2 state)
  if (!raw.moduleType) {
    raw.moduleType = 'csm';
    changed = true;
  }

  // Migrate bare favorite IDs ("42") to scoped format ("csm:<chainId>:42")
  const migrated = raw.favorites.map((fav) => {
    if (!fav.includes(':')) {
      changed = true;
      return `csm:${raw.chainId}:${fav}`;
    }
    return fav;
  });

  if (changed) {
    raw.favorites = migrated;
  }

  return raw;
}

export async function getState(): Promise<WalletState> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const raw = (data[STORAGE_KEY] as WalletState | undefined) ?? { ...DEFAULT_WALLET_STATE };
  const state = migrateState(raw);

  // Persist if migration changed anything
  if (raw !== state || !data[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  return state;
}

export async function setState(
  update: Partial<WalletState>,
): Promise<WalletState> {
  const current = await getState();
  const next = { ...current, ...update };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
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
