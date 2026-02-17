/**
 * Three message protocols:
 *
 * 1. Inpage ↔ Content Script: window.postMessage with channel discrimination
 * 2. Content Script ↔ Service Worker: chrome.runtime.sendMessage
 * 3. Popup ↔ Service Worker: chrome.runtime.connect (port)
 */

import type { ModuleType } from './types.js';
import type { RpcError } from './errors.js';

// ── Inpage ↔ Content Script (window.postMessage) ──────────────────────

export const MSG_CHANNEL = 'csm-dev-wallet';

export type InpageMessage = {
  channel: typeof MSG_CHANNEL;
  direction: 'to-content' | 'to-inpage';
} & (
  | { type: 'rpc-request'; id: number; method: string; params?: unknown[] }
  | { type: 'rpc-response'; id: number; result?: unknown; error?: RpcError }
  | { type: 'event'; event: string; data: unknown }
);

// ── Content Script ↔ Service Worker (chrome.runtime) ──────────────────

export type RpcRequestMessage = {
  type: 'rpc-request';
  method: string;
  params?: unknown[];
};

export type RpcResponseMessage = {
  type: 'rpc-response';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

// ── Popup ↔ Service Worker (port) ─────────────────────────────────────

export const PORT_NAME = 'csm-popup';

export type PopupCommand =
  | { type: 'get-state' }
  | { type: 'select-address'; address: string; source: import('./types.js').AddressSource }
  | { type: 'disconnect' }
  | { type: 'switch-network'; chainId: number }
  | { type: 'switch-module'; moduleType: ModuleType }
  | { type: 'request-operators'; chainId: number; moduleType: ModuleType }
  | { type: 'refresh-operators'; chainId: number; moduleType: ModuleType }
  | { type: 'toggle-favorite'; operatorId: string }
  | { type: 'add-manual-address'; address: string }
  | { type: 'remove-manual-address'; address: string }
  | { type: 'set-custom-rpc'; chainId: number; rpcUrl: string };

export type ModuleAvailability = Partial<Record<ModuleType, boolean>>;

export type PopupEvent =
  | { type: 'state-update'; state: import('./types.js').WalletState }
  | { type: 'operators-update'; chainId: number; moduleType: ModuleType; operators: import('./types.js').CachedOperator[]; lastFetchedAt: number }
  | { type: 'operators-loading'; chainId: number; moduleType: ModuleType; loading: boolean }
  | { type: 'module-availability'; modules: ModuleAvailability }
  | { type: 'error'; message: string };

// ── Service Worker → Content Script (broadcast) ──────────────────────

export type BroadcastMessage =
  | { type: 'state-changed'; event: 'accountsChanged'; data: string[] }
  | { type: 'state-changed'; event: 'chainChanged'; data: string };
