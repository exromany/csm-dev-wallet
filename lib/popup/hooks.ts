import { useState, useEffect, useCallback, useMemo, useRef, type RefObject } from 'react';
import type { WalletState, CachedOperator, ModuleType } from '../shared/types.js';
import { DEFAULT_WALLET_STATE } from '../shared/types.js';
import { PORT_NAME, type PopupCommand, type PopupEvent, type ModuleAvailability } from '../shared/messages.js';
import { ANVIL_CHAIN_ID, type SupportedChainId } from '../shared/networks.js';
import { MODULE_ORDER, BASELINE_MODULE, PROBED_MODULES } from '../shared/modules.js';
import type { Address } from 'viem';
import {
  buildAttachmentIndex,
  sharedAddresses,
  type AddressAttachments,
} from '../shared/attachments.js';

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

// ── useSharedAddresses ──

export type SharedFilter = 'all' | 'cross' | 'pending';

/**
 * Addresses attached to more than one operator, at least one in the site's
 * current module — attachments are still gathered across every module deployed
 * on this network.
 *
 * Reuses `request-operators` (which already takes an arbitrary moduleType) rather
 * than adding a protocol message, so cold and stale caches fetch through exactly
 * the same path as the Operators tab.
 */
export function useSharedAddresses(
  port: chrome.runtime.Port | null,
  origin: string | null,
  chainId: number,
  moduleType: ModuleType,
  availableModules: ModuleAvailability,
  enabled: boolean,
) {
  const [byModule, setByModule] = useState<Partial<Record<ModuleType, CachedOperator[]>>>({});
  const [loadingModules, setLoadingModules] = useState<ModuleType[]>([]);
  const [settledModules, setSettledModules] = useState<ModuleType[]>([]);
  const [fetchedAt, setFetchedAt] = useState<Partial<Record<ModuleType, number>>>({});

  // A stale availability cache written before a module existed omits its key —
  // "map is non-empty" isn't enough, every probed module must have answered.
  const resolved = PROBED_MODULES.every((m) => availableModules[m] !== undefined);
  const wantedKey = MODULE_ORDER.filter((m) => m === BASELINE_MODULE || availableModules[m]).join(',');
  const wanted = useMemo<ModuleType[]>(() => wantedKey.split(',') as ModuleType[], [wantedKey]);
  const chainIdRef = useRef(chainId);
  chainIdRef.current = chainId;

  useEffect(() => {
    // Held off until the Shared tab is actually visited, so a popup that never
    // opens it doesn't fire a redundant CSM fetch (Operators tab already does)
    // plus a full fetch of every other module on every open. Also held off until
    // every module's availability is known, so `wanted` doesn't change identity
    // mid-flight and re-request.
    if (!port || !origin || !enabled || !resolved) return;

    setByModule({});
    setLoadingModules([]);
    setSettledModules([]);
    setFetchedAt({});

    const settle = (moduleType: ModuleType) =>
      setSettledModules((prev) => (prev.includes(moduleType) ? prev : [...prev, moduleType]));

    const handler = (event: PopupEvent) => {
      if (event.type === 'operators-update') {
        if (event.chainId !== chainIdRef.current) return;
        if (!wanted.includes(event.moduleType)) return;
        setByModule((prev) => ({ ...prev, [event.moduleType]: event.operators }));
        settle(event.moduleType);
        setFetchedAt((prev) => ({ ...prev, [event.moduleType]: event.lastFetchedAt }));
      }
      if (event.type === 'operators-loading') {
        if (event.chainId !== chainIdRef.current) return;
        if (!wanted.includes(event.moduleType)) return;
        setLoadingModules((prev) =>
          event.loading
            ? (prev.includes(event.moduleType) ? prev : [...prev, event.moduleType])
            : prev.filter((m) => m !== event.moduleType),
        );
        // A failed fetch broadcasts loading:false with no operators-update — still
        // counts as settled, or a stuck cache never lets `loading` clear.
        if (!event.loading) settle(event.moduleType);
      }
    };

    port.onMessage.addListener(handler);
    for (const moduleType of wanted) {
      try {
        port.postMessage({ type: 'request-operators', origin, chainId, moduleType } satisfies PopupCommand);
      } catch {
        // Port disconnected — useWalletState reopens on focus
      }
    }
    return () => port.onMessage.removeListener(handler);
  }, [port, origin, chainId, wanted, enabled, resolved]);

  const refresh = useCallback(() => {
    if (!port || !origin || !resolved) return;
    for (const moduleType of wanted) {
      try {
        port.postMessage({ type: 'refresh-operators', origin, chainId, moduleType } satisfies PopupCommand);
      } catch {
        // Port disconnected — useWalletState reopens on focus
      }
    }
  }, [port, origin, chainId, wanted, resolved]);

  const index = useMemo(() => buildAttachmentIndex(byModule), [byModule]);
  const addresses = useMemo(() => sharedAddresses(index, moduleType), [index, moduleType]);

  // Report the STALEST module, so "updated Xm ago" never overstates freshness.
  // A module that settled without an operators-update (e.g. a failed fetch)
  // has no stamp — null out rather than silently reporting a partial index.
  const lastFetchedAt = useMemo(() => {
    const stamps = wanted.map((m) => fetchedAt[m]);
    if (stamps.some((t) => t === undefined)) return null;
    return Math.min(...(stamps as number[]));
  }, [fetchedAt, wanted]);

  // Counts must never render half-built, so a module that hasn't settled yet
  // (update received, or a failed fetch) keeps the whole tab in its loading state.
  const answered = wanted.filter((m) => settledModules.includes(m)).length;
  const loading = enabled && (loadingModules.length > 0 || answered < wanted.length);

  return { addresses, index, loading, lastFetchedAt, refresh };
}

/** Scope + search filter for the Shared tab. */
export function filterSharedAddresses(
  list: AddressAttachments[],
  search: string,
  filter: SharedFilter,
  addressLabels: Record<string, string> = {},
): AddressAttachments[] {
  const scoped = list.filter((e) => {
    if (filter === 'cross') return e.crossModule;
    if (filter === 'pending') return e.pending;
    return true;
  });

  const raw = search.trim();
  if (!raw) return scoped;

  // #N → exact operator ID match, mirroring filterOperators
  if (raw.startsWith('#')) {
    const id = raw.slice(1);
    return scoped.filter((e) => e.attachments.some((a) => a.operatorId === id));
  }

  const q = raw.toLowerCase();
  return scoped.filter(
    (e) =>
      e.address.toLowerCase().includes(q) ||
      (addressLabels[e.address.toLowerCase()] ?? '').toLowerCase().includes(q) ||
      e.attachments.some(
        (a) => a.operatorId.includes(q) || a.typeLabel.toLowerCase().includes(q),
      ),
  );
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

  const get = useCallback(
    (operatorId: string, moduleType?: ModuleType) =>
      state.operatorLabels[`${moduleType ?? state.moduleType}:${chainIdForPrefix}:${operatorId}`] ?? '',
    [state.operatorLabels, state.moduleType, chainIdForPrefix],
  );

  const set = useCallback(
    (operatorId: string, label: string, moduleType?: ModuleType) =>
      send({ type: 'set-operator-label', operatorId, label, ...(moduleType ? { moduleType } : {}) }),
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
