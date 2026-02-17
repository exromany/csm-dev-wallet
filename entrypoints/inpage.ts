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
    icon: 'data:image/png;base64,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',
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
