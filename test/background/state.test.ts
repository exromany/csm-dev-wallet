import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADDR_A, makeSiteState, makeGlobalSettings } from '../fixtures.js';

// ── In-memory chrome.storage.local mock ──

let store: Record<string, unknown>;

function mockStorage() {
  store = {};
  vi.mocked(chrome.storage.local.get).mockImplementation((keys) => {
    const result: Record<string, unknown> = {};
    const keyList = Array.isArray(keys) ? keys : [keys as string];
    for (const k of keyList) result[k] = store[k];
    return Promise.resolve(result);
  });
  vi.mocked(chrome.storage.local.set).mockImplementation((items) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  vi.mocked(chrome.storage.local.remove).mockImplementation((keys) => {
    const keyList = Array.isArray(keys) ? keys : [keys as string];
    for (const k of keyList) delete store[k];
    return Promise.resolve();
  });
}

// ── Tabs mock ──

let tabsList: Array<{ id?: number; url?: string }>;

function mockTabs(tabs: Array<{ id?: number; url?: string }>) {
  tabsList = tabs;
  vi.mocked(chrome.tabs.query).mockResolvedValue(tabsList as chrome.tabs.Tab[]);
  chrome.tabs.sendMessage = vi.fn().mockResolvedValue(undefined);
}

// ── Fresh import helper ──

type StateModule = typeof import('../../lib/background/state.js');

async function importState(): Promise<StateModule> {
  return import('../../lib/background/state.ts') as unknown as StateModule;
}

// ── Tests ──

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockStorage();
  mockTabs([]);
});

describe('getGlobalSettings', () => {
  it('returns defaults when storage is empty', async () => {
    const { getGlobalSettings } = await importState();
    const settings = await getGlobalSettings();
    expect(settings).toEqual(makeGlobalSettings());
  });

  it('persists and reads back settings', async () => {
    const { setGlobalSettings } = await importState();
    await setGlobalSettings({ favorites: ['csm:1:42'] });
    // Clear cache by re-importing
    vi.resetModules();
    const mod2 = await importState();
    const settings = await mod2.getGlobalSettings();
    expect(settings.favorites).toEqual(['csm:1:42']);
  });

  it('merges partial updates without overwriting unrelated fields', async () => {
    const { setGlobalSettings, getGlobalSettings } = await importState();
    await setGlobalSettings({ favorites: ['csm:1:1'], requireApproval: true });
    await setGlobalSettings({ requireApproval: false });
    const settings = await getGlobalSettings();
    expect(settings.favorites).toEqual(['csm:1:1']);
    expect(settings.requireApproval).toBe(false);
  });
});

describe('getSiteState / setSiteState', () => {
  it('returns default disconnected state for unknown origin', async () => {
    const { getSiteState } = await importState();
    const site = await getSiteState('https://unknown.com');
    expect(site).toEqual(makeSiteState());
    expect(site.isConnected).toBe(false);
    expect(site.selectedAddress).toBeNull();
  });

  it('persists and reads back site state', async () => {
    const { setSiteState } = await importState();
    await setSiteState('https://app.example.com', {
      chainId: 560048,
      isConnected: true,
    });
    // Re-import to bypass cache
    vi.resetModules();
    const mod2 = await importState();
    const site = await mod2.getSiteState('https://app.example.com');
    expect(site.chainId).toBe(560048);
    expect(site.isConnected).toBe(true);
  });

  it('different origins have independent state', async () => {
    const { setSiteState, getSiteState } = await importState();
    await setSiteState('https://a.com', { chainId: 1, isConnected: true });
    await setSiteState('https://b.com', { chainId: 560048, isConnected: false });
    expect((await getSiteState('https://a.com')).chainId).toBe(1);
    expect((await getSiteState('https://a.com')).isConnected).toBe(true);
    expect((await getSiteState('https://b.com')).chainId).toBe(560048);
    expect((await getSiteState('https://b.com')).isConnected).toBe(false);
  });
});

describe('origin isolation', () => {
  it('setting site state for origin A does not affect origin B', async () => {
    const { setSiteState, getSiteState } = await importState();
    await setSiteState('https://a.com', { isConnected: true });
    const b = await getSiteState('https://b.com');
    expect(b.isConnected).toBe(false); // default
  });

  it('origin A on mainnet, origin B on Hoodi — both persist correctly', async () => {
    const { setSiteState } = await importState();
    const addrA = { address: ADDR_A, source: { type: 'manual' as const } };
    await setSiteState('https://a.com', { chainId: 1, selectedAddress: addrA });
    await setSiteState('https://b.com', { chainId: 560048, selectedAddress: null });

    // Re-import to verify persistence
    vi.resetModules();
    const mod2 = await importState();
    const a = await mod2.getSiteState('https://a.com');
    const b = await mod2.getSiteState('https://b.com');
    expect(a.chainId).toBe(1);
    expect(a.selectedAddress).toEqual(addrA);
    expect(b.chainId).toBe(560048);
    expect(b.selectedAddress).toBeNull();
  });
});

describe('getComposedState', () => {
  it('merges site state with global settings', async () => {
    const { setSiteState, setGlobalSettings, getComposedState } = await importState();
    await setGlobalSettings({ favorites: ['csm:1:5'], requireApproval: true });
    await setSiteState('https://app.com', { chainId: 560048, isConnected: true });
    const composed = await getComposedState('https://app.com');
    // Site fields
    expect(composed.chainId).toBe(560048);
    expect(composed.isConnected).toBe(true);
    // Global fields
    expect(composed.favorites).toEqual(['csm:1:5']);
    expect(composed.requireApproval).toBe(true);
  });

  it('uses correct origin site state', async () => {
    const { setSiteState, getComposedState } = await importState();
    await setSiteState('https://a.com', { chainId: 1 });
    await setSiteState('https://b.com', { chainId: 560048 });
    expect((await getComposedState('https://a.com')).chainId).toBe(1);
    expect((await getComposedState('https://b.com')).chainId).toBe(560048);
  });
});

describe('legacy migration', () => {
  it('migrates wallet_state → split global_settings + site_states', async () => {
    store['wallet_state'] = {
      chainId: 1,
      moduleType: 'csm',
      customRpcUrls: { 1: 'https://custom.rpc' },
      favorites: ['csm:1:42'],
      manualAddresses: [],
      addressLabels: {},
      requireApproval: true,
    };

    const { getGlobalSettings, getSiteState } = await importState();
    const settings = await getGlobalSettings();
    expect(settings.customRpcUrls).toEqual({ 1: 'https://custom.rpc' });
    expect(settings.favorites).toEqual(['csm:1:42']);
    expect(settings.requireApproval).toBe(true);
    // Legacy key removed
    expect(store['wallet_state']).toBeUndefined();
    // Site states initialized empty (no per-origin data in legacy)
    const site = await getSiteState('https://any.com');
    expect(site).toEqual(makeSiteState());
  });

  it('migrates bare favorite IDs to scoped format', async () => {
    store['wallet_state'] = {
      chainId: 560048,
      moduleType: 'cm',
      favorites: ['7', '13', 'csm:1:99'],
    };

    const { getGlobalSettings } = await importState();
    const settings = await getGlobalSettings();
    expect(settings.favorites).toEqual(['cm:560048:7', 'cm:560048:13', 'csm:1:99']);
  });

  it('removes legacy key after migration', async () => {
    store['wallet_state'] = { favorites: [] };
    const { getGlobalSettings } = await importState();
    await getGlobalSettings();
    expect(store['wallet_state']).toBeUndefined();
  });

  it('no-op when legacy key does not exist', async () => {
    const { getGlobalSettings } = await importState();
    const settings = await getGlobalSettings();
    expect(settings).toEqual(makeGlobalSettings());
    // Storage should only have global_settings, no wallet_state
    expect(store['wallet_state']).toBeUndefined();
  });
});

describe('broadcast targeting', () => {
  it('notifyAccountsChanged only sends to tabs matching origin', async () => {
    mockTabs([
      { id: 1, url: 'https://stake.lido.fi/csm' },
      { id: 2, url: 'https://other.app/page' },
      { id: 3, url: 'https://stake.lido.fi/withdraw' },
    ]);

    const { notifyAccountsChanged } = await importState();
    await notifyAccountsChanged('https://stake.lido.fi', [ADDR_A]);

    const sendMessage = vi.mocked(chrome.tabs.sendMessage);
    const sentIds = sendMessage.mock.calls.map(([id]) => id);
    expect(sentIds).toEqual([1, 3]);
    expect(sendMessage.mock.calls[0]![1]).toMatchObject({
      type: 'state-changed',
      event: 'accountsChanged',
      data: [ADDR_A],
    });
  });

  it('notifyChainChanged skips tabs with different origin', async () => {
    mockTabs([
      { id: 1, url: 'https://a.com/page' },
      { id: 2, url: 'https://b.com/page' },
    ]);

    const { notifyChainChanged } = await importState();
    await notifyChainChanged('https://b.com', 560048);

    const sendMessage = vi.mocked(chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe(2);
    expect(sendMessage.mock.calls[0]![1]).toMatchObject({
      event: 'chainChanged',
      data: '0x88bb0',
    });
  });

  it('tabs without id or url are skipped', async () => {
    mockTabs([
      { url: 'https://a.com' },         // no id
      { id: 2 },                         // no url
      { id: 3, url: 'https://a.com' },   // valid
    ]);

    const { notifyAccountsChanged } = await importState();
    await notifyAccountsChanged('https://a.com', []);

    const sendMessage = vi.mocked(chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]![0]).toBe(3);
  });
});
