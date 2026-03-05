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
  origin: string;
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

// All commands include origin (active tab's origin) so the service worker
// can compose and return the correct per-site + global state view.
export type PopupCommand =
  | { type: 'get-state'; origin: string }
  | { type: 'select-address'; origin: string; address: string; source: import('./types.js').AddressSource }
  | { type: 'disconnect'; origin: string }
  | { type: 'switch-network'; origin: string; chainId: number }
  | { type: 'switch-module'; origin: string; moduleType: ModuleType }
  | { type: 'request-operators'; origin: string; chainId: number; moduleType: ModuleType }
  | { type: 'refresh-operators'; origin: string; chainId: number; moduleType: ModuleType }
  | { type: 'toggle-favorite'; origin: string; operatorId: string }
  | { type: 'add-manual-address'; origin: string; address: string }
  | { type: 'remove-manual-address'; origin: string; address: string }
  | { type: 'set-custom-rpc'; origin: string; chainId: number; rpcUrl: string }
  | { type: 'set-address-label'; origin: string; address: string; label: string }
  | { type: 'set-require-approval'; origin: string; enabled: boolean };

export type ModuleAvailability = Partial<Record<ModuleType, boolean>>;

export type PopupEvent =
  | { type: 'state-update'; state: import('./types.js').WalletState }
  | { type: 'operators-update'; chainId: number; moduleType: ModuleType; operators: import('./types.js').CachedOperator[]; lastFetchedAt: number }
  | { type: 'operators-loading'; chainId: number; moduleType: ModuleType; loading: boolean }
  | { type: 'module-availability'; modules: ModuleAvailability }
  | { type: 'anvil-status'; forkedFrom: import('./networks.js').SupportedChainId | null; accounts: import('viem').Address[] }
  | { type: 'error'; message: string };

// ── Approval window ↔ Service Worker (chrome.runtime.sendMessage) ────

export type ApprovalResponse = {
  type: 'approval-response';
  id: string;
  approved: boolean;
};

// ── Service Worker → Content Script (broadcast) ──────────────────────

export type BroadcastMessage =
  | { type: 'state-changed'; origin: string; event: 'accountsChanged'; data: string[] }
  | { type: 'state-changed'; origin: string; event: 'chainChanged'; data: string };
