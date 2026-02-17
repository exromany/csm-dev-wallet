import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { MSG_CHANNEL, type InpageMessage } from '../lib/shared/messages.js';

export default defineUnlistedScript(() => {
  // ── Event emitter ──

  type Listener = (...args: any[]) => void;
  const listeners = new Map<string, Set<Listener>>();

  function on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  }

  function removeListener(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn);
  }

  function emit(event: string, ...args: any[]) {
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
    const wrapper = (...args: any[]) => {
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
        pending.set(id, { resolve, reject });

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
        const errData = msg.error as any;
        const err = new Error(errData.message ?? 'Unknown error');
        (err as any).code = errData.code;
        if (errData.data !== undefined) (err as any).data = errData.data;
        p.reject(err);
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
    (window as any).ethereum = provider;
  }

  // ── EIP-6963 announcement ──

  const info = {
    uuid: crypto.randomUUID(),
    name: 'CSM Dev Wallet',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%2300A3FF"/><text x="50" y="65" text-anchor="middle" font-size="40" fill="white" font-family="sans-serif">CSM</text></svg>',
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
