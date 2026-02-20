import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const { rawJsonRpc } = vi.hoisted(() => ({ rawJsonRpc: vi.fn() }));
vi.mock('../../lib/background/rpc.ts', () => ({ rawJsonRpc }));

const MAINNET_CSM = '0x1111111111111111111111111111111111111111';
const HOODI_CSM = '0x2222222222222222222222222222222222222222';

vi.mock('@lidofinance/lido-csm-sdk/common', () => ({
  CSM_CONTRACT_ADDRESSES: {
    1: { csModule: '0x1111111111111111111111111111111111111111' },
    560048: { csModule: '0x2222222222222222222222222222222222222222' },
  },
}));

// ── Imports under test ──

import {
  getForkedFrom,
  setForkedFrom,
  clearForkedFrom,
  detectAnvilFork,
  getAnvilAccounts,
  withImpersonation,
} from '../../lib/background/anvil.js';

const RPC = 'http://127.0.0.1:8545';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(chrome.storage.session.get).mockResolvedValue({});
  vi.mocked(chrome.storage.session.set).mockResolvedValue(undefined);
  vi.mocked(chrome.storage.session.remove).mockResolvedValue(undefined);
  await clearForkedFrom();
});

// ── Fork state ──

describe('getForkedFrom / setForkedFrom / clearForkedFrom', () => {
  it('initially returns null', async () => {
    expect(await getForkedFrom()).toBeNull();
  });

  it('returns value after setForkedFrom', async () => {
    await setForkedFrom(1);
    expect(await getForkedFrom()).toBe(1);
  });

  it('returns null after clearForkedFrom', async () => {
    await setForkedFrom(1);
    await clearForkedFrom();
    expect(await getForkedFrom()).toBeNull();
  });

  it('falls back to session storage when in-memory is null', async () => {
    // Simulate service worker restart: in-memory is null, session has value
    vi.mocked(chrome.storage.session.get).mockResolvedValue({ anvilForkedFrom: 560048 });

    expect(await getForkedFrom()).toBe(560048);
  });
});

// ── detectAnvilFork ──

describe('detectAnvilFork', () => {
  it('returns supported chainId from anvil_nodeInfo', async () => {
    rawJsonRpc.mockResolvedValue({
      result: { environment: { chainId: 1 } },
    });

    expect(await detectAnvilFork(RPC)).toBe(1);
  });

  it('returns null on RPC error', async () => {
    rawJsonRpc.mockResolvedValue({
      error: { code: -32601, message: 'not found' },
    });

    expect(await detectAnvilFork(RPC)).toBeNull();
  });

  it('returns null when nodeInfo has no environment', async () => {
    rawJsonRpc.mockResolvedValue({ result: {} });

    expect(await detectAnvilFork(RPC)).toBeNull();
  });

  it('chainId 31337 probes contracts — detects Mainnet', async () => {
    rawJsonRpc.mockImplementation(async (_url: string, method: string, params?: unknown[]) => {
      if (method === 'anvil_nodeInfo') {
        return { result: { environment: { chainId: 31337 } } };
      }
      if (method === 'eth_getCode') {
        // Mainnet CSM has code
        return { result: params?.[0] === MAINNET_CSM ? '0x6080' : '0x' };
      }
      return { result: null };
    });

    expect(await detectAnvilFork(RPC)).toBe(1);
  });

  it('chainId 31337 probes contracts — detects Hoodi', async () => {
    rawJsonRpc.mockImplementation(async (_url: string, method: string, params?: unknown[]) => {
      if (method === 'anvil_nodeInfo') {
        return { result: { environment: { chainId: 31337 } } };
      }
      if (method === 'eth_getCode') {
        // Only Hoodi CSM has code
        return { result: params?.[0] === HOODI_CSM ? '0x6080' : '0x' };
      }
      return { result: null };
    });

    expect(await detectAnvilFork(RPC)).toBe(560048);
  });

  it('returns null when contracts not found', async () => {
    rawJsonRpc.mockImplementation(async (_url: string, method: string) => {
      if (method === 'anvil_nodeInfo') {
        return { result: { environment: { chainId: 31337 } } };
      }
      return { result: '0x' }; // no code anywhere
    });

    expect(await detectAnvilFork(RPC)).toBeNull();
  });

  it('returns null when rawJsonRpc throws', async () => {
    rawJsonRpc.mockRejectedValue(new Error('network error'));

    expect(await detectAnvilFork(RPC)).toBeNull();
  });
});

// ── getAnvilAccounts ──

describe('getAnvilAccounts', () => {
  it('returns addresses from eth_accounts', async () => {
    const addrs = ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
    rawJsonRpc.mockResolvedValue({ result: addrs });

    expect(await getAnvilAccounts(RPC)).toEqual(addrs);
  });

  it('returns [] on error', async () => {
    rawJsonRpc.mockRejectedValue(new Error('fail'));

    expect(await getAnvilAccounts(RPC)).toEqual([]);
  });
});

// ── withImpersonation ──

describe('withImpersonation', () => {
  const addr = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa' as const;

  it('impersonates, runs fn, stops impersonating', async () => {
    rawJsonRpc.mockResolvedValue({ result: null });
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withImpersonation(RPC, addr, fn);

    expect(result).toBe('ok');
    expect(rawJsonRpc).toHaveBeenNthCalledWith(1, RPC, 'anvil_impersonateAccount', [addr]);
    expect(fn).toHaveBeenCalled();
    expect(rawJsonRpc).toHaveBeenNthCalledWith(2, RPC, 'anvil_stopImpersonatingAccount', [addr]);
  });

  it('throws when impersonation fails', async () => {
    rawJsonRpc.mockResolvedValue({ error: { code: -32000, message: 'denied' } });

    await expect(withImpersonation(RPC, addr, vi.fn())).rejects.toThrow('denied');
  });

  it('calls stop-impersonating even if fn throws', async () => {
    rawJsonRpc.mockResolvedValue({ result: null });
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withImpersonation(RPC, addr, fn)).rejects.toThrow('boom');

    expect(rawJsonRpc).toHaveBeenLastCalledWith(RPC, 'anvil_stopImpersonatingAccount', [addr]);
  });
});
