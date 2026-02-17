import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { WalletState, CachedOperator, ModuleType } from '../shared/types.js';
import { DEFAULT_WALLET_STATE } from '../shared/types.js';
import { PORT_NAME, type PopupCommand, type PopupEvent } from '../shared/messages.js';

// ── useWalletState ──

export function useWalletState() {
  const [state, setLocalState] = useState<WalletState>(DEFAULT_WALLET_STATE);
  const [port, setPort] = useState<chrome.runtime.Port | null>(null);

  useEffect(() => {
    const p = chrome.runtime.connect({ name: PORT_NAME });
    setPort(p);

    p.onMessage.addListener((event: PopupEvent) => {
      if (event.type === 'state-update') {
        setLocalState(event.state);
      }
    });

    // Request initial state
    p.postMessage({ type: 'get-state' } satisfies PopupCommand);

    return () => p.disconnect();
  }, []);

  const send = useCallback(
    (command: PopupCommand) => port?.postMessage(command),
    [port],
  );

  return { state, send, port };
}

// ── useOperators ──

export function useOperators(
  port: chrome.runtime.Port | null,
  chainId: number,
  moduleType: ModuleType,
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
    if (!port) return;

    // Reset state on chain/module change
    setOperators([]);
    setLoading(false);
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
    return () => port.onMessage.removeListener(handler);
  }, [port, chainId, moduleType]);

  const refresh = useCallback(() => {
    port?.postMessage({
      type: 'refresh-operators',
      chainId,
      moduleType,
    } satisfies PopupCommand);
  }, [port, chainId, moduleType]);

  const filtered = useMemo(() => {
    if (!search) return operators;
    const q = search.toLowerCase();
    return operators.filter(
      (op) =>
        op.id.includes(q) ||
        op.managerAddress.toLowerCase().includes(q) ||
        op.rewardsAddress.toLowerCase().includes(q),
    );
  }, [operators, search]);

  return { operators: filtered, allOperators: operators, loading, lastFetchedAt, search, setSearch, refresh };
}

// ── useFavorites ──

export function useFavorites(
  state: WalletState,
  send: (cmd: PopupCommand) => void,
) {
  const prefix = `${state.moduleType}:${state.chainId}:`;

  const toggle = useCallback(
    (operatorId: string) => send({ type: 'toggle-favorite', operatorId }),
    [send],
  );

  const isFavorite = useCallback(
    (operatorId: string) => state.favorites.includes(`${prefix}${operatorId}`),
    [state.favorites, prefix],
  );

  return { toggle, isFavorite };
}
