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
    // When opened as a connection prompt window, origin is passed as a URL param
    const paramOrigin = new URLSearchParams(window.location.search).get('origin');
    if (paramOrigin) {
      setOrigin(paramOrigin);
      return;
    }

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

    // MV3 terminates the service worker after ~30s idle and at a 5min hard cap,
    // even with an open port. When the popup outlives the SW (devtools attached,
    // popup as tab, connection-prompt window), the port disconnects. We listen
    // for disconnect and reopen on visibility/focus so a stale popup keeps working.
    let active = true;
    let current: chrome.runtime.Port | null = null;

    const open = () => {
      const p = chrome.runtime.connect({ name: PORT_NAME });
      current = p;

      p.onMessage.addListener((event: PopupEvent) => {
        if (event.type === 'state-update') {
          setLocalState(event.state);
          setError(null);
        }
        if (event.type === 'error') {
          setError(event.message);
        }
      });

      p.onDisconnect.addListener(() => {
        if (current === p) current = null;
        if (active) setPort((cur) => (cur === p ? null : cur));
      });

      // Request initial state for this origin. get-state on the SW side re-triggers
      // anvil-status, module-availability, and operator refresh — so a fresh port
      // gets a fully-resynced view automatically.
      try {
        p.postMessage({ type: 'get-state', origin } satisfies PopupCommand);
      } catch {
        // Port died before first message — onDisconnect will clear and visibility/focus will retry
      }

      setPort(p);
    };

    open();

    const reconnect = () => {
      if (!active) return;
      if (document.visibilityState !== 'visible') return;
      if (current) return;
      open();
    };

    document.addEventListener('visibilitychange', reconnect);
    window.addEventListener('focus', reconnect);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', reconnect);
      window.removeEventListener('focus', reconnect);
      try { current?.disconnect(); } catch {}
      current = null;
      setPort(null);
    };
  }, [origin]);

  const send = useCallback(
    (command: PopupCommandInput) => {
      if (!port || !origin) return;
      try {
        // Inject origin into every command
        port.postMessage({ ...command, origin } as PopupCommand);
      } catch {
        // Port died between React render and click — clear so visibility/focus reopens it
        setPort(null);
      }
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
  getOperatorLabel: (operatorId: string) => string = () => '',
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
    try {
      port.postMessage({
        type: 'request-operators',
        origin,
        chainId,
        moduleType,
      } satisfies PopupCommand);
    } catch {
      // Port disconnected between render and effect — useWalletState reopens on focus
    }
    return () => port.onMessage.removeListener(handler);
  }, [port, origin, chainId, moduleType]);

  const refresh = useCallback(() => {
    if (!origin || !port) return;
    try {
      port.postMessage({
        type: 'refresh-operators',
        origin,
        chainId,
        moduleType,
      } satisfies PopupCommand);
    } catch {
      // Port disconnected — useWalletState will reopen on focus
    }
  }, [port, origin, chainId, moduleType]);

  const filtered = useMemo(
    () => filterOperators(operators, search, addressLabels, getOperatorLabel),
    [operators, search, addressLabels, getOperatorLabel],
  );

  return { operators: filtered, allOperators: operators, loading, lastFetchedAt, search, setSearch, refresh };
}

// ── useModuleAvailability ──

export function useModuleAvailability(port: chrome.runtime.Port | null) {
  const [modules, setModules] = useState<ModuleAvailability>({});

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

// ── useGroupFavorites ──
// Group favorites are scoped by module+chain just like operator favorites, but
// keyed by groupId. Anvil maps to its forkedFrom chain so a fork shares group
// favorites with the underlying network.

export function useGroupFavorites(
  state: WalletState,
  send: (cmd: PopupCommandInput) => void,
  forkedFrom?: SupportedChainId | null,
) {
  const chainIdForPrefix = (state.chainId === ANVIL_CHAIN_ID && forkedFrom)
    ? forkedFrom
    : state.chainId;
  const prefix = `${state.moduleType}:${chainIdForPrefix}:`;

  const toggle = useCallback(
    (groupId: string) => send({ type: 'toggle-group-favorite', groupId }),
    [send],
  );

  const favoriteSet = useMemo(
    () => new Set(state.groupFavorites),
    [state.groupFavorites],
  );

  const isFavorite = useCallback(
    (groupId: string) => favoriteSet.has(`${prefix}${groupId}`),
    [favoriteSet, prefix],
  );

  return { toggle, isFavorite };
}

// ── useOperatorLabels ──
// Operator labels are user-set names for operators (e.g. "Kiln", "P2P.org"),
// scoped by module + chain so the same numeric ID across networks stays distinct.

export function useOperatorLabels(
  state: WalletState,
  send: (cmd: PopupCommandInput) => void,
  forkedFrom?: SupportedChainId | null,
) {
  const chainIdForPrefix = (state.chainId === ANVIL_CHAIN_ID && forkedFrom)
    ? forkedFrom
    : state.chainId;
  const prefix = `${state.moduleType}:${chainIdForPrefix}:`;

  const get = useCallback(
    (operatorId: string) => state.operatorLabels[`${prefix}${operatorId}`] ?? '',
    [state.operatorLabels, prefix],
  );

  const set = useCallback(
    (operatorId: string, label: string) =>
      send({ type: 'set-operator-label', operatorId, label }),
    [send],
  );

  return { get, set };
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

// ── filterByGroup ──

export type FilterGroup = 'all' | 'favorites' | 'pending';

/**
 * Flat-list filter. Favorites includes operators starred individually OR
 * belonging to a starred group (a starred group implicitly pins its members).
 */
export function filterByGroup(
  operators: CachedOperator[],
  group: FilterGroup,
  isFavorite: (id: string) => boolean,
  isGroupFavorite: (groupId: string) => boolean = () => false,
): CachedOperator[] {
  if (group === 'favorites') {
    return operators.filter(
      (op) => isFavorite(op.id) || (op.groupId !== undefined && isGroupFavorite(op.groupId)),
    );
  }
  if (group === 'pending') return operators.filter((op) => op.proposedManagerAddress || op.proposedRewardsAddress);
  return operators;
}

// ── filterGroupedView ──
// Grouped-view filter operates on whole groups, per spec:
//   • all       — every group, plus the "No group" bucket
//   • favorites — only starred groups (hide "No group" entirely)
//   • pending   — groups holding any pending op, with non-pending members
//                 stripped out; plus pending ungrouped operators
import type { GroupedOperators, OperatorGroup } from '../shared/groups.js';

export type GroupedFilterResult = {
  groups: { group: OperatorGroup; partial: boolean }[];
  ungrouped: CachedOperator[];
};

function opIsPending(op: CachedOperator): boolean {
  return Boolean(op.proposedManagerAddress || op.proposedRewardsAddress);
}

export function filterGroupedView(
  grouped: GroupedOperators,
  scope: FilterGroup,
  isGroupFavorite: (groupId: string) => boolean,
): GroupedFilterResult {
  if (scope === 'favorites') {
    return {
      groups: grouped.groups
        .filter((g) => isGroupFavorite(g.id))
        .map((group) => ({ group, partial: false })),
      ungrouped: [],
    };
  }
  if (scope === 'pending') {
    const groups: GroupedFilterResult['groups'] = [];
    for (const g of grouped.groups) {
      const pendingOps = g.operators.filter(opIsPending);
      if (pendingOps.length === 0) continue;
      groups.push({
        group: { ...g, operators: pendingOps },
        partial: pendingOps.length < g.operators.length,
      });
    }
    return { groups, ungrouped: grouped.ungrouped.filter(opIsPending) };
  }
  return {
    groups: grouped.groups.map((group) => ({ group, partial: false })),
    ungrouped: grouped.ungrouped,
  };
}

// ── filterOperators ──

export function filterOperators(
  operators: CachedOperator[],
  search: string,
  addressLabels: Record<string, string> = {},
  getOperatorLabel: (operatorId: string) => string = () => '',
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
      getOperatorLabel(op.id).toLowerCase().includes(q) ||
      (addressLabels[op.managerAddress.toLowerCase()] ?? '').toLowerCase().includes(q) ||
      (addressLabels[op.rewardsAddress.toLowerCase()] ?? '').toLowerCase().includes(q) ||
      (op.proposedManagerAddress && (addressLabels[op.proposedManagerAddress.toLowerCase()] ?? '').toLowerCase().includes(q)) ||
      (op.proposedRewardsAddress && (addressLabels[op.proposedRewardsAddress.toLowerCase()] ?? '').toLowerCase().includes(q)),
  );
}
