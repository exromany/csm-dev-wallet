import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import type { WalletState, CachedOperator, ModuleType } from '../shared/types.js';
import { DEFAULT_WALLET_STATE } from '../shared/types.js';
import { PORT_NAME, type PopupCommand, type PopupEvent, type ModuleAvailability } from '../shared/messages.js';
import { ANVIL_CHAIN_ID, type SupportedChainId } from '../shared/networks.js';
import type { Address } from 'viem';

// Strip `origin` from PopupCommand — the hook injects it automatically
type WithoutOrigin<T> = T extends { origin: string }
  ? Omit<T, 'origin'>
  : T;
export type PopupCommandInput = WithoutOrigin<PopupCommand>;

// ── useActiveTabOrigin ──

function useActiveTabOrigin() {
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (url) {
        try {
          setOrigin(new URL(url).origin);
        } catch {
          setOrigin(location.origin);
        }
      } else {
        // activeTab not granted (e.g. popup opened as a tab in e2e tests)
        setOrigin(location.origin);
      }
    });
  }, []);

  return origin;
}

// ── useWalletState ──

export function useWalletState() {
  const [state, setLocalState] = useState<WalletState>(DEFAULT_WALLET_STATE);
  const [error, setError] = useState<string | null>(null);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);
  const origin = useActiveTabOrigin();

  useEffect(() => {
    if (!origin) return;

    const p = chrome.runtime.connect({ name: PORT_NAME });
    setPort(p);

    p.onMessage.addListener((event: PopupEvent) => {
      if (event.type === 'state-update') {
        setLocalState(event.state);
        setError(null);
      }
      if (event.type === 'error') {
        setError(event.message);
      }
    });

    // Request initial state for this origin
    p.postMessage({ type: 'get-state', origin } satisfies PopupCommand);

    return () => {
      p.disconnect();
      setPort(null);
    };
  }, [origin]);

  const send = useCallback(
    (command: PopupCommandInput) => {
      if (!port || !origin) return;
      // Inject origin into every command
      port.postMessage({ ...command, origin } as PopupCommand);
    },
    [port, origin],
  );

  const clearError = useCallback(() => setError(null), []);

  return { state, send, port, origin, error, clearError };
}

// ── useOperators ──

export function useOperators(
  port: chrome.runtime.Port | null,
  origin: string | null,
  chainId: number,
  moduleType: ModuleType,
  addressLabels: Record<string, string> = {},
) {
  const [operators, setOperators] = useState<CachedOperator[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const chainIdRef = useRef(chainId);
  const moduleTypeRef = useRef(moduleType);
  chainIdRef.current = chainId;
  moduleTypeRef.current = moduleType;

  useEffect(() => {
    if (!port || !origin) return;

    // Reset state on chain/module change
    setOperators([]);
    setLoading(true);
    setLastFetchedAt(null);

    const handler = (event: PopupEvent) => {
      const curChain = chainIdRef.current;
      const curModule = moduleTypeRef.current;
      if (
        event.type === 'operators-update' &&
        event.chainId === curChain &&
        event.moduleType === curModule
      ) {
        setOperators(event.operators);
        setLastFetchedAt(event.lastFetchedAt);
        setLoading(false);
      }
      if (
        event.type === 'operators-loading' &&
        event.chainId === curChain &&
        event.moduleType === curModule
      ) {
        setLoading(event.loading);
      }
    };

    port.onMessage.addListener(handler);
    port.postMessage({
      type: 'request-operators',
      origin,
      chainId,
      moduleType,
    } satisfies PopupCommand);
    return () => port.onMessage.removeListener(handler);
  }, [port, origin, chainId, moduleType]);

  const refresh = useCallback(() => {
    if (!origin) return;
    port?.postMessage({
      type: 'refresh-operators',
      origin,
      chainId,
      moduleType,
    } satisfies PopupCommand);
  }, [port, origin, chainId, moduleType]);

  const filtered = useMemo(() => filterOperators(operators, search, addressLabels), [operators, search, addressLabels]);

  return { operators: filtered, allOperators: operators, loading, lastFetchedAt, search, setSearch, refresh };
}

// ── useModuleAvailability ──

export function useModuleAvailability(port: chrome.runtime.Port | null) {
  const [modules, setModules] = useState<ModuleAvailability>({ csm: true, cm: false });

  useEffect(() => {
    if (!port) return;

    const handler = (event: PopupEvent) => {
      if (event.type === 'module-availability') {
        setModules(event.modules);
      }
    };

    port.onMessage.addListener(handler);
    return () => port.onMessage.removeListener(handler);
  }, [port]);

  return modules;
}

// ── useAnvilStatus ──

export type AnvilStatus = {
  forkedFrom: SupportedChainId | null;
  accounts: Address[];
};

export function useAnvilStatus(port: chrome.runtime.Port | null) {
  const [status, setStatus] = useState<AnvilStatus>({ forkedFrom: null, accounts: [] });

  useEffect(() => {
    if (!port) return;
    const handler = (event: PopupEvent) => {
      if (event.type === 'anvil-status') {
        setStatus({ forkedFrom: event.forkedFrom, accounts: event.accounts });
      }
    };
    port.onMessage.addListener(handler);
    return () => port.onMessage.removeListener(handler);
  }, [port]);

  return status;
}

// ── useFavorites ──

export function useFavorites(
  state: WalletState,
  send: (cmd: PopupCommandInput) => void,
  forkedFrom?: SupportedChainId | null,
) {
  const chainIdForPrefix = (state.chainId === ANVIL_CHAIN_ID && forkedFrom)
    ? forkedFrom
    : state.chainId;
  const prefix = `${state.moduleType}:${chainIdForPrefix}:`;

  const toggle = useCallback(
    (operatorId: string) => send({ type: 'toggle-favorite', operatorId }),
    [send],
  );

  const favoriteSet = useMemo(() => new Set(state.favorites), [state.favorites]);

  const isFavorite = useCallback(
    (operatorId: string) => favoriteSet.has(`${prefix}${operatorId}`),
    [favoriteSet, prefix],
  );

  return { toggle, isFavorite };
}

// ── useCopyAddress ──

export function useCopyAddress() {
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const timerRef: RefObject<ReturnType<typeof setTimeout> | null> = useRef(null);

  const copy = useCallback((address: string) => {
    navigator.clipboard.writeText(address).then(() => {
      setCopiedAddr(address.toLowerCase());
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopiedAddr(null), 1500);
    }).catch(() => {});
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const isCopied = useCallback(
    (address: string) => copiedAddr === address.toLowerCase(),
    [copiedAddr],
  );

  return { copy, isCopied };
}

// ── filterOperators ──

export function filterOperators(
  operators: CachedOperator[],
  search: string,
  addressLabels: Record<string, string> = {},
): CachedOperator[] {
  if (!search) return operators;
  const raw = search.trim();
  if (!raw) return operators;

  // #N → exact ID match
  if (raw.startsWith('#')) {
    const id = raw.slice(1);
    return operators.filter((op) => op.id === id);
  }

  const q = raw.toLowerCase();
  return operators.filter(
    (op) =>
      op.id.includes(q) ||
      op.operatorType.toLowerCase().includes(q) ||
      op.managerAddress.toLowerCase().includes(q) ||
      op.rewardsAddress.toLowerCase().includes(q) ||
      op.proposedManagerAddress?.toLowerCase().includes(q) ||
      op.proposedRewardsAddress?.toLowerCase().includes(q) ||
      (addressLabels[op.managerAddress.toLowerCase()] ?? '').toLowerCase().includes(q) ||
      (addressLabels[op.rewardsAddress.toLowerCase()] ?? '').toLowerCase().includes(q) ||
      (op.proposedManagerAddress && (addressLabels[op.proposedManagerAddress.toLowerCase()] ?? '').toLowerCase().includes(q)) ||
      (op.proposedRewardsAddress && (addressLabels[op.proposedRewardsAddress.toLowerCase()] ?? '').toLowerCase().includes(q)),
  );
}
