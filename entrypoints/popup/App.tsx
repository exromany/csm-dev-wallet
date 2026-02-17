import React, { useState, useMemo, useEffect } from 'react';
import { useWalletState, useOperators, useFavorites, useModuleAvailability } from '../../lib/popup/hooks.js';
import { formatTimeAgo } from '../../lib/popup/utils.js';
import { NetworkSelector } from './NetworkSelector.js';
import { ModuleSelector } from './ModuleSelector.js';
import { ConnectedBar } from './ConnectedBar.js';
import { OperatorList } from './OperatorList.js';
import { ManualAddresses } from './ManualAddresses.js';
import { Settings } from './Settings.js';

type Tab = 'operators' | 'manual' | 'settings';

export function App() {
  const { state, send, port } = useWalletState();
  const { operators, loading, lastFetchedAt, search, setSearch, refresh } = useOperators(
    port,
    state.chainId,
    state.moduleType,
  );
  const favorites = useFavorites(state, send);
  const availableModules = useModuleAvailability(port);
  const [tab, setTab] = useState<Tab>('operators');

  // Auto-switch away from CM if it becomes unavailable
  useEffect(() => {
    if (state.moduleType === 'cm' && availableModules.cm === false) {
      send({ type: 'switch-module', moduleType: 'csm' });
    }
  }, [availableModules.cm, state.moduleType, send]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const displayOperators = useMemo(
    () => showFavoritesOnly
      ? operators.filter((op) => favorites.isFavorite(op.id))
      : operators,
    [operators, showFavoritesOnly, favorites],
  );

  return (
    <div className="app">
      <div className="header">
        <h1>CSM Dev Wallet</h1>
        <NetworkSelector
          chainId={state.chainId}
          onSwitch={(chainId) => send({ type: 'switch-network', chainId })}
        />
      </div>

      <ModuleSelector
        moduleType={state.moduleType}
        availableModules={availableModules}
        onSwitch={(moduleType) => send({ type: 'switch-module', moduleType })}
      />

      {state.selectedAddress && (
        <ConnectedBar
          address={state.selectedAddress}
          onDisconnect={() => send({ type: 'disconnect' })}
        />
      )}

      <div className="tabs">
        {(['operators', 'manual', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'operators' ? 'Operators' : t === 'manual' ? 'Manual' : 'Settings'}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === 'operators' && (
          <>
            <input
              className="search-bar"
              placeholder="Search by ID or address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="filter-bar">
              <button
                className={`filter-btn ${!showFavoritesOnly ? 'active' : ''}`}
                onClick={() => setShowFavoritesOnly(false)}
              >
                All
              </button>
              <button
                className={`filter-btn ${showFavoritesOnly ? 'active' : ''}`}
                onClick={() => setShowFavoritesOnly(true)}
              >
                Favorites
              </button>
              <div className="spacer" />
              {lastFetchedAt && (
                <span className="staleness-label">
                  Updated {formatTimeAgo(lastFetchedAt)}
                </span>
              )}
              <button className="filter-btn" onClick={refresh} disabled={loading}>
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            <OperatorList
              operators={displayOperators}
              loading={loading}
              selectedAddress={state.selectedAddress?.address}
              favorites={favorites}
              onSelect={(address, operatorId, role) =>
                send({
                  type: 'select-address',
                  address,
                  source: { type: 'operator', operatorId, role },
                })
              }
            />
          </>
        )}

        {tab === 'manual' && (
          <ManualAddresses
            addresses={state.manualAddresses}
            selectedAddress={state.selectedAddress?.address}
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

        {tab === 'settings' && (
          <Settings
            state={state}
            onSetRpc={(chainId, rpcUrl) =>
              send({ type: 'set-custom-rpc', chainId, rpcUrl })
            }
          />
        )}
      </div>
    </div>
  );
}
