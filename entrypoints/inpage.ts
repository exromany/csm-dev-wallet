import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { MSG_CHANNEL, type InpageMessage } from '../lib/shared/messages.js';
import { ProviderRpcError } from '../lib/shared/errors.js';
import { WALLET_ICON_DATA_URI } from '../lib/shared/wallet-icon.js';

const REQUEST_TIMEOUT_MS = 30_000;

export default defineUnlistedScript(() => {
  // ── Event emitter ──

  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<Listener>>();

  function on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  }

  function removeListener(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn);
  }

  function emit(event: string, ...args: unknown[]) {
    listeners.get(event)?.forEach((fn) => {
      try {
        fn(...args);
      } catch {
        // listener error — don't break provider
      }
    });
  }

  // ── Pending requests ──

  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();

  // ── EIP-1193 Provider ──

  function once(event: string, fn: Listener) {
    const wrapper = (...args: unknown[]) => {
      removeListener(event, wrapper);
      fn(...args);
    };
    on(event, wrapper);
  }

  const provider = {
    isCSMDevWallet: true,
    isMetaMask: false, // don't impersonate MetaMask
    isConnected: true,

    request({ method, params }: { method: string; params?: unknown[] }) {
      return new Promise((resolve, reject) => {
        const id = nextId++;

        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ProviderRpcError(-32603, 'CSM Dev Wallet: request timed out'));
        }, REQUEST_TIMEOUT_MS);

        pending.set(id, {
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });

        window.postMessage(
          {
            channel: MSG_CHANNEL,
            direction: 'to-content',
            type: 'rpc-request',
            id,
            method,
            params,
          } satisfies InpageMessage,
          window.location.origin,
        );
      });
    },

    on,
    once,
    removeListener,
    off: removeListener,

    // Legacy
    enable() {
      return provider.request({ method: 'eth_requestAccounts' });
    },
    send(method: string, params?: unknown[]) {
      return provider.request({ method, params });
    },
  };

  // ── Listen for responses from content script ──

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data as InpageMessage;
    if (msg?.channel !== MSG_CHANNEL || msg.direction !== 'to-inpage') return;

    if (msg.type === 'rpc-response') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);

      if (msg.error) {
        p.reject(new ProviderRpcError(
          msg.error.code,
          msg.error.message ?? 'Unknown error',
          msg.error.data,
        ));
      } else {
        p.resolve(msg.result);
      }
    }

    if (msg.type === 'event') {
      emit(msg.event, msg.data);
    }
  });

  // ── Install provider ──

  try {
    Object.defineProperty(window, 'ethereum', {
      value: provider,
      writable: false,
      configurable: true, // allow other extensions to override
    });
  } catch {
    (window as unknown as Record<string, unknown>).ethereum = provider;
  }

  // ── EIP-6963 announcement ──

  const info = {
    uuid: crypto.randomUUID(),
    name: 'CSM Dev Wallet',
    icon: WALLET_ICON_DATA_URI,
    rdns: 'fi.lido.csm-dev-wallet',
  };

  function announceProvider() {
    window.dispatchEvent(
      new CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info, provider }),
      }),
    );
  }

  // Announce immediately
  announceProvider();

  // Re-announce when dapp requests (Reef-Knot pattern)
  window.addEventListener('eip6963:requestProvider', announceProvider);
});
