import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  useWalletState,
  useOperators,
  useFavorites,
  useGroupFavorites,
  useViewMode,
  useModuleAvailability,
  useAnvilStatus,
  useOperatorLabels,
  filterByGroup,
  type FilterGroup,
} from '../../lib/popup/hooks.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { formatTimeAgo } from '../../lib/popup/utils.js';
import { NetworkModuleChip, NetworkModulePanel } from './NetworkSelector.js';
import { ConnectedBar } from './ConnectedBar.js';
import { OperatorList } from './OperatorList.js';
import { OperatorGroups, ViewToggle } from './OperatorGroups.js';
import { ManualAddresses } from './ManualAddresses.js';
import { Settings } from './Settings.js';

type Tab = 'operators' | 'manual' | 'settings';
type Theme = 'dark' | 'light';
const THEME_KEY = 'csm-wallet-theme';

function readInitialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  return 'dark';
}

export function App() {
  const { state, send, port, origin, error, clearError } = useWalletState();
  const anvilStatus = useAnvilStatus(port);
  const favorites = useFavorites(state, send, anvilStatus.forkedFrom);
  const groupFavorites = useGroupFavorites(state, send, anvilStatus.forkedFrom);
  const [viewMode, setViewMode] = useViewMode(state, send);
  const operatorLabels = useOperatorLabels(state, send, anvilStatus.forkedFrom);
  const {
    operators,
    allOperators,
    loading,
    lastFetchedAt,
    search,
    setSearch,
    refresh,
  } = useOperators(
    port,
    origin,
    state.chainId,
    state.moduleType,
    state.addressLabels,
    operatorLabels.get,
  );
  const availableModules = useModuleAvailability(port);
  const [tab, setTab] = useState<Tab>('operators');
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [filterGroup, setFilterGroup] = useState<FilterGroup>('all');
  const [netModOpen, setNetModOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }, [theme]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) return;
      // Don't hijack typing — Ctrl+K is a common browser shortcut, and users
      // editing a manual address, RPC URL, or operator label would lose their
      // work if we yanked the tab/focus out from under them.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        return;
      }
      e.preventDefault();
      setTab('operators');
      requestAnimationFrame(() => {
        const input = searchInputRef.current;
        if (input) {
          input.focus();
          input.select();
        }
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Auto-switch away from CM if it becomes unavailable
  useEffect(() => {
    if (state.moduleType === 'cm' && availableModules.cm === false) {
      send({ type: 'switch-module', moduleType: 'csm' });
    }
  }, [availableModules.cm, state.moduleType, send]);

  const { isFavorite } = favorites;
  const { isFavorite: isGroupFavorite } = groupFavorites;
  // Grouped view only makes sense for CM (where operators have groups).
  // Force list view for CSM so the toggle is a no-op there.
  const effectiveViewMode = state.moduleType === 'cm' ? viewMode : 'list';

  // Pending isn't available in grouped mode — drop the user back to "All" so
  // the filter pill they have selected matches what's actually shown.
  useEffect(() => {
    if (effectiveViewMode === 'grouped' && filterGroup === 'pending') {
      setFilterGroup('all');
    }
  }, [effectiveViewMode, filterGroup]);

  const displayOperators = useMemo(
    () => filterByGroup(operators, filterGroup, isFavorite, isGroupFavorite),
    [operators, filterGroup, isFavorite, isGroupFavorite],
  );

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <div className="brand-mark">◆</div>
          <div className="brand-name">CSM Dev</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☾' : '☀'}
        </button>
        <NetworkModuleChip
          chainId={state.chainId}
          moduleType={state.moduleType}
          forkedFrom={anvilStatus.forkedFrom}
          open={netModOpen}
          onToggle={() => setNetModOpen((o) => !o)}
          chipRef={chipRef}
        />
      </div>

      {netModOpen && (
        <NetworkModulePanel
          chainId={state.chainId}
          moduleType={state.moduleType}
          forkedFrom={anvilStatus.forkedFrom}
          availableModules={availableModules}
          onSwitchNetwork={(chainId) => send({ type: 'switch-network', chainId })}
          onSwitchModule={(moduleType) => send({ type: 'switch-module', moduleType })}
          onClose={() => setNetModOpen(false)}
          chipRef={chipRef}
        />
      )}

      {state.selectedAddress && (
        <ConnectedBar
          address={state.selectedAddress}
          chainId={state.chainId}
          label={state.addressLabels[state.selectedAddress.address.toLowerCase()] ?? ''}
          onDisconnect={() => send({ type: 'disconnect' })}
        />
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="tabs">
        {([
          ['operators', 'Operators'],
          ['manual', 'Manual'],
          ['settings', 'Settings'],
        ] as const).map(([t, label]) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => { setTab(t); clearError(); }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === 'operators' && (
          <>
            <div className="search-wrapper">
              <div className="search-row">
                <div className="search-bar">
                  <span className="search-icon">⌕</span>
                  <input
                    ref={searchInputRef}
                    placeholder="Search #ID, address, label…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search ? (
                    <button className="search-clear" onClick={() => setSearch('')}>×</button>
                  ) : (
                    <kbd className="kbd">⌘K</kbd>
                  )}
                </div>
                {state.moduleType === 'cm' && (
                  <ViewToggle mode={viewMode} onChange={setViewMode} />
                )}
              </div>
              <div className="filter-bar">
                <button
                  className={`filter-btn ${filterGroup === 'all' ? 'active' : ''}`}
                  onClick={() => setFilterGroup('all')}
                >
                  All
                </button>
                <button
                  className={`filter-btn ${filterGroup === 'favorites' ? 'active' : ''}`}
                  onClick={() => setFilterGroup('favorites')}
                >
                  Favorites
                </button>
                {effectiveViewMode === 'list' && (
                  <button
                    className={`filter-btn ${filterGroup === 'pending' ? 'active' : ''}`}
                    onClick={() => setFilterGroup('pending')}
                    title="Operators with pending P-MGR or P-RWD role-change proposals"
                  >
                    Pending
                  </button>
                )}
                <div className="spacer" />
                {lastFetchedAt && (
                  <span className="staleness-label">
                    updated {formatTimeAgo(lastFetchedAt)}
                  </span>
                )}
                <button className="refresh-btn" onClick={refresh} disabled={loading}>
                  {loading ? 'loading…' : '↻ refresh'}
                </button>
              </div>
            </div>
            {state.chainId === ANVIL_CHAIN_ID && !anvilStatus.forkedFrom && !loading && (
              <div className="empty-state">
                Anvil not detected.
                <br />
                Start a local fork to browse operators.
              </div>
            )}
            {effectiveViewMode === 'grouped' ? (
              <OperatorGroups
                operators={operators}
                allOperatorsCount={allOperators.length}
                loading={loading}
                scope={filterGroup}
                selectedAddress={state.selectedAddress?.address}
                favorites={favorites}
                groupFavorites={groupFavorites}
                operatorLabels={operatorLabels}
                onSelect={(address, operatorId, role) =>
                  send({
                    type: 'select-address',
                    address,
                    source: { type: 'operator', operatorId, role },
                  })
                }
              />
            ) : (
              <OperatorList
                operators={displayOperators}
                allOperatorsCount={allOperators.length}
                loading={loading}
                selectedAddress={state.selectedAddress?.address}
                favorites={favorites}
                operatorLabels={operatorLabels}
                onSelect={(address, operatorId, role) =>
                  send({
                    type: 'select-address',
                    address,
                    source: { type: 'operator', operatorId, role },
                  })
                }
              />
            )}
          </>
        )}

        {tab === 'manual' && (
          <ManualAddresses
            addresses={state.manualAddresses}
            anvilAccounts={state.chainId === ANVIL_CHAIN_ID ? anvilStatus.accounts : []}
            selectedAddress={state.selectedAddress?.address}
            addressLabels={state.addressLabels}
            onSetLabel={(address, label) =>
              send({ type: 'set-address-label', address, label })
            }
            onAdd={(address) => send({ type: 'add-manual-address', address })}
            onRemove={(address) =>
              send({ type: 'remove-manual-address', address })
            }
            onSelect={(address) =>
              send({
                type: 'select-address',
                address,
                source: { type: 'manual' },
              })
            }
            onSelectAnvil={(address, index) =>
              send({
                type: 'select-address',
                address,
                source: { type: 'anvil', index },
              })
            }
          />
        )}

        {tab === 'settings' && (
          <Settings
            state={state}
            onSetRpc={(chainId, rpcUrl) =>
              send({ type: 'set-custom-rpc', chainId, rpcUrl })
            }
            onSetRequireApproval={(enabled) =>
              send({ type: 'set-require-approval', enabled })
            }
          />
        )}
      </div>
    </div>
  );
}
