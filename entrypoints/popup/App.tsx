import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  useWalletState,
  useOperators,
  useFavorites,
  useGroupFavorites,
  useModuleAvailability,
  useAnvilStatus,
  useOperatorLabels,
  useSharedAddresses,
  filterByGroup,
  type FilterGroup,
} from '../../lib/popup/hooks.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { formatTimeAgo } from '../../lib/popup/utils.js';
import { NetworkModuleChip, NetworkModulePanel } from './NetworkSelector.js';
import { ConnectedBar } from './ConnectedBar.js';
import { OperatorList } from './OperatorList.js';
import { OperatorGroups } from './OperatorGroups.js';
import { ManualAddresses } from './ManualAddresses.js';
import { AnvilAccounts } from './AnvilAccounts.js';
import { SharedAddresses } from './SharedAddresses.js';
import { Settings } from './Settings.js';
import { THEME_KEY } from './theme-init.js';
import { IconClose, IconMoon, IconSearch, IconSun } from './icons.js';
import type { PopupTab } from '../../lib/shared/types.js';

// Settings is the one tab we never persist — see PopupTab.
type Tab = PopupTab | 'settings';
type Theme = 'dark' | 'light';

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
  // `null` until the user picks a tab this session — until then the effective
  // tab tracks the persisted `state.activeTab`, so reopening lands where we left.
  const [tab, setTab] = useState<Tab | null>(null);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [filterGroup, setFilterGroup] = useState<FilterGroup>('all');
  // Tracks the popover's open state — used only to flip the chip's caret. The
  // browser owns show/hide via the `popovertarget` invoker; this mirrors it.
  const [netModOpen, setNetModOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sharedVisitedRef = useRef(false);

  // Switch tabs locally for an instant response, and persist the choice per-site
  // so it's restored on reopen. Settings is intentionally not persisted.
  const selectTab = useCallback(
    (next: Tab) => {
      setTab(next);
      clearError();
      if (next !== 'settings') send({ type: 'set-active-tab', tab: next });
    },
    [send, clearError],
  );
  // The Ctrl+K listener is bound once; route it through a ref so it always calls
  // the latest selectTab without re-subscribing on every send/origin change.
  const selectTabRef = useRef(selectTab);
  selectTabRef.current = selectTab;

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
      selectTabRef.current('operators');
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

  const onAnvil = state.chainId === ANVIL_CHAIN_ID;
  const showGroups = state.moduleType === 'cm';
  // Until the user touches a tab this session, follow the persisted choice.
  const selectedTab = tab ?? state.activeTab;
  // Derive so tabs that don't exist in the current context fall back cleanly —
  // Anvil only on the Anvil network, Groups only for CM. No effect, no blank frame.
  let activeTab: Tab = selectedTab;
  if (!onAnvil && activeTab === 'anvil') activeTab = 'operators';
  if (!showGroups && activeTab === 'groups') activeTab = 'operators';

  // Sticky: once visited, keep fetching so switching away and back doesn't
  // re-request. Avoids firing the Shared tab's cross-module fetch (and its
  // duplicate CSM request alongside the Operators tab) on every popup open.
  sharedVisitedRef.current ||= activeTab === 'shared';
  const sharedAddrs = useSharedAddresses(
    port,
    origin,
    state.chainId,
    availableModules.cm,
    sharedVisitedRef.current,
  );

  const { isFavorite } = favorites;
  const { isFavorite: isGroupFavorite } = groupFavorites;

  const displayOperators = useMemo(
    () => filterByGroup(operators, filterGroup, isFavorite, isGroupFavorite),
    [operators, filterGroup, isFavorite, isGroupFavorite],
  );

  // Pending is list-only; on the Groups tab it reads as "All". Derive rather than
  // mutating filterGroup, so the user's Pending choice survives a round-trip to Groups.
  const groupScope: FilterGroup = activeTab === 'groups' && filterGroup === 'pending' ? 'all' : filterGroup;

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <div className="brand-mark">◆</div>
          <div className="brand-name">CSM Dev</div>
        </div>
        <button
          className="icon-btn hint"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          data-hint={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <IconMoon size={14} /> : <IconSun size={14} />}
        </button>
        <NetworkModuleChip
          chainId={state.chainId}
          moduleType={state.moduleType}
          forkedFrom={anvilStatus.forkedFrom}
          open={netModOpen}
        />
        <NetworkModulePanel
          chainId={state.chainId}
          moduleType={state.moduleType}
          forkedFrom={anvilStatus.forkedFrom}
          availableModules={availableModules}
          onSwitchNetwork={(chainId) => send({ type: 'switch-network', chainId })}
          onSwitchModule={(moduleType) => send({ type: 'switch-module', moduleType })}
          onOpenChange={setNetModOpen}
          onOpenSettings={() => selectTab('settings')}
        />
      </div>

      {state.selectedAddress && (
        <ConnectedBar
          address={state.selectedAddress}
          chainId={state.chainId}
          label={state.addressLabels[state.selectedAddress.address.toLowerCase()] ?? ''}
          onSetLabel={(label) =>
            send({ type: 'set-address-label', address: state.selectedAddress!.address, label })
          }
          onDisconnect={() => send({ type: 'disconnect' })}
        />
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="tabs">
        {(
          [
            ['operators', 'Operators'],
            ...(showGroups ? ([['groups', 'Groups']] as const) : []),
            ['shared', 'Shared'],
            ['manual', 'Manual'],
            ...(onAnvil ? ([['anvil', 'Anvil']] as const) : []),
          ] satisfies ReadonlyArray<readonly [Tab, string]>
        ).map(([t, label]) => (
          <button
            key={t}
            className={`tab ${activeTab === t ? 'active' : ''}`}
            onClick={() => selectTab(t)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="content">
        {(activeTab === 'operators' || activeTab === 'groups') && (
          <>
            <SearchToolbar
              search={search}
              onSearch={setSearch}
              searchInputRef={searchInputRef}
              filterGroup={groupScope}
              onFilterGroup={setFilterGroup}
              showPending={activeTab === 'operators'}
              loading={loading}
              lastFetchedAt={lastFetchedAt}
              onRefresh={refresh}
            />
            {state.chainId === ANVIL_CHAIN_ID && !anvilStatus.forkedFrom && !loading && (
              <div className="empty-state">
                Anvil not detected.
                <br />
                Start a local fork to browse operators.
              </div>
            )}
            {activeTab === 'groups' ? (
              <OperatorGroups
                operators={operators}
                allOperatorsCount={allOperators.length}
                loading={loading}
                scope={groupScope}
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

        {activeTab === 'manual' && (
          <ManualAddresses
            addresses={state.manualAddresses}
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
          />
        )}

        {activeTab === 'shared' && (
          <SharedAddresses
            addresses={sharedAddrs.addresses}
            loading={sharedAddrs.loading}
            lastFetchedAt={sharedAddrs.lastFetchedAt}
            cmMissing={sharedAddrs.cmMissing}
            addressLabels={state.addressLabels}
            operatorLabels={operatorLabels}
            selectedAddress={state.selectedAddress?.address}
            siteModuleType={state.moduleType}
            onRefresh={sharedAddrs.refresh}
            onSelect={(address, operatorId, role, moduleType) =>
              send({
                type: 'select-address',
                address,
                source: { type: 'operator', operatorId, role },
                // Only sent when it differs, so same-module picks keep the existing behaviour.
                ...(moduleType !== state.moduleType ? { moduleType } : {}),
              })
            }
            onSetAddressLabel={(address, label) =>
              send({ type: 'set-address-label', address, label })
            }
          />
        )}

        {activeTab === 'anvil' && (
          <AnvilAccounts
            accounts={anvilStatus.accounts}
            forkedFrom={anvilStatus.forkedFrom}
            selectedAddress={state.selectedAddress?.address}
            addressLabels={state.addressLabels}
            onSetLabel={(address, label) =>
              send({ type: 'set-address-label', address, label })
            }
            onSelect={(address, index) =>
              send({
                type: 'select-address',
                address,
                source: { type: 'anvil', index },
              })
            }
          />
        )}

        {activeTab === 'settings' && (
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

function SearchToolbar({
  search,
  onSearch,
  searchInputRef,
  filterGroup,
  onFilterGroup,
  showPending,
  loading,
  lastFetchedAt,
  onRefresh,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  filterGroup: FilterGroup;
  onFilterGroup: (group: FilterGroup) => void;
  showPending: boolean;
  loading: boolean;
  lastFetchedAt: number | null;
  onRefresh: () => void;
}) {
  return (
    <div className="search-wrapper">
      <div className="search-row">
        <div className="search-bar">
          <span className="search-icon"><IconSearch size={14} /></span>
          <input
            ref={searchInputRef}
            placeholder="Search #ID, address, label…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search ? (
            <button className="search-clear" onClick={() => onSearch('')}><IconClose size={12} /></button>
          ) : (
            <kbd className="kbd">⌘K</kbd>
          )}
        </div>
      </div>
      <div className="filter-bar">
        <button
          className={`filter-btn ${filterGroup === 'all' ? 'active' : ''}`}
          onClick={() => onFilterGroup('all')}
        >
          All
        </button>
        <button
          className={`filter-btn ${filterGroup === 'favorites' ? 'active' : ''}`}
          onClick={() => onFilterGroup('favorites')}
        >
          Favorites
        </button>
        {showPending && (
          <button
            className={`filter-btn hint ${filterGroup === 'pending' ? 'active' : ''}`}
            onClick={() => onFilterGroup('pending')}
            data-hint="Operators with pending P-MGR or P-RWD role-change proposals"
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
        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'loading…' : '↻ refresh'}
        </button>
      </div>
    </div>
  );
}
