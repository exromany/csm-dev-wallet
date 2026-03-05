import type { SiteState, GlobalSettings, WalletState } from '../shared/types.js';
import { DEFAULT_SITE_STATE, DEFAULT_GLOBAL_SETTINGS } from '../shared/types.js';
import type { BroadcastMessage } from '../shared/messages.js';

const GLOBAL_KEY = 'global_settings';
const SITES_KEY = 'site_states';
const LEGACY_KEY = 'wallet_state';

// ── In-memory caches ──

let globalCache: GlobalSettings | null = null;
let sitesCache: Record<string, SiteState> | null = null;
let writeLock: Promise<void> = Promise.resolve();

export function resetCaches() {
  globalCache = null;
  sitesCache = null;
}

// ── Migration from legacy single-key storage ──

/** Migrate legacy `wallet_state` to split storage. Returns true if migration occurred. */
async function migrateLegacy(): Promise<boolean> {
  const data = await chrome.storage.local.get(LEGACY_KEY);
  const legacy = data[LEGACY_KEY] as Record<string, unknown> | undefined;
  if (!legacy) return false;

  // Extract global settings from legacy state
  const global: GlobalSettings = {
    customRpcUrls: (legacy.customRpcUrls as GlobalSettings['customRpcUrls']) ?? {},
    favorites: (legacy.favorites as string[]) ?? [],
    manualAddresses: (legacy.manualAddresses as GlobalSettings['manualAddresses']) ?? [],
    addressLabels: (legacy.addressLabels as GlobalSettings['addressLabels']) ?? {},
    requireApproval: (legacy.requireApproval as boolean) ?? false,
  };

  // Migrate bare favorite IDs to scoped format
  const chainId = (legacy.chainId as number) ?? 1;
  const moduleType = (legacy.moduleType as string) ?? 'csm';
  global.favorites = global.favorites.map((fav) =>
    fav.includes(':') ? fav : `${moduleType}:${chainId}:${fav}`,
  );

  await chrome.storage.local.set({
    [GLOBAL_KEY]: global,
    [SITES_KEY]: {},
  });
  await chrome.storage.local.remove(LEGACY_KEY);

  return true;
}

// ── Global settings ──

export async function getGlobalSettings(): Promise<GlobalSettings> {
  if (globalCache) return globalCache;

  await migrateLegacy();

  const data = await chrome.storage.local.get(GLOBAL_KEY);
  const raw = (data[GLOBAL_KEY] as GlobalSettings | undefined) ?? { ...DEFAULT_GLOBAL_SETTINGS };

  // Ensure all fields exist (forward-compat)
  const settings: GlobalSettings = {
    customRpcUrls: raw.customRpcUrls ?? {},
    favorites: raw.favorites ?? [],
    manualAddresses: raw.manualAddresses ?? [],
    addressLabels: raw.addressLabels ?? {},
    requireApproval: raw.requireApproval ?? false,
  };

  globalCache = settings;
  return settings;
}

export async function setGlobalSettings(
  update: Partial<GlobalSettings>,
): Promise<GlobalSettings> {
  const result = writeLock.then(async () => {
    const current = await getGlobalSettings();
    const next = { ...current, ...update };
    globalCache = next;
    await chrome.storage.local.set({ [GLOBAL_KEY]: next });
    return next;
  });
  writeLock = result.then(() => {}, () => {});
  return result;
}

// ── Per-origin site state ──

async function getAllSiteStates(): Promise<Record<string, SiteState>> {
  if (sitesCache) return sitesCache;

  await migrateLegacy();

  const data = await chrome.storage.local.get(SITES_KEY);
  const sites = (data[SITES_KEY] as Record<string, SiteState> | undefined) ?? {};
  sitesCache = sites;
  return sites;
}

export async function getSiteState(origin: string): Promise<SiteState> {
  const sites = await getAllSiteStates();
  return sites[origin] ?? { ...DEFAULT_SITE_STATE };
}

export async function setSiteState(
  origin: string,
  update: Partial<SiteState>,
): Promise<SiteState> {
  const result = writeLock.then(async () => {
    const sites = await getAllSiteStates();
    const current = sites[origin] ?? { ...DEFAULT_SITE_STATE };
    const next = { ...current, ...update };
    const updated = { ...sites, [origin]: next };
    sitesCache = updated;
    await chrome.storage.local.set({ [SITES_KEY]: updated });
    return next;
  });
  writeLock = result.then(() => {}, () => {});
  return result;
}

// ── Composed state for popup ──

export async function getComposedState(origin: string): Promise<WalletState> {
  const [site, global] = await Promise.all([
    getSiteState(origin),
    getGlobalSettings(),
  ]);
  return { ...site, ...global };
}

// ── Origin-aware broadcasts ──

/** Broadcast to tabs matching a specific origin */
async function broadcastToOrigin(origin: string, message: BroadcastMessage) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    try {
      const tabOrigin = new URL(tab.url).origin;
      if (tabOrigin === origin) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    } catch {
      // Invalid URL — skip
    }
  }
}

export async function notifyAccountsChanged(origin: string, accounts: string[]) {
  await broadcastToOrigin(origin, {
    type: 'state-changed',
    origin,
    event: 'accountsChanged',
    data: accounts,
  });
}

export async function notifyChainChanged(origin: string, chainId: number) {
  await broadcastToOrigin(origin, {
    type: 'state-changed',
    origin,
    event: 'chainChanged',
    data: `0x${chainId.toString(16)}`,
  });
}
