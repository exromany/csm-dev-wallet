import React, { useState, useMemo, useEffect } from 'react';
import { useWalletState, useOperators, useFavorites, useModuleAvailability, useAnvilStatus } from '../../lib/popup/hooks.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { formatTimeAgo } from '../../lib/popup/utils.js';
import { NetworkSelector } from './NetworkSelector.js';
import { ModuleSelector } from './ModuleSelector.js';
import { ConnectedBar } from './ConnectedBar.js';
import { OperatorList } from './OperatorList.js';
import { ManualAddresses } from './ManualAddresses.js';
import { Settings } from './Settings.js';

type Tab = 'operators' | 'manual' | 'settings';

export function App() {
  const { state, send, port, error, clearError } = useWalletState();
  const { operators, allOperators, loading, lastFetchedAt, search, setSearch, refresh } = useOperators(
    port,
    state.chainId,
    state.moduleType,
    state.addressLabels,
  );
  const anvilStatus = useAnvilStatus(port);
  const favorites = useFavorites(state, send, anvilStatus.forkedFrom);
  const availableModules = useModuleAvailability(port);
  const [tab, setTab] = useState<Tab>('operators');

  // Auto-switch away from CM if it becomes unavailable
  useEffect(() => {
    if (state.moduleType === 'cm' && availableModules.cm === false) {
      send({ type: 'switch-module', moduleType: 'csm' });
    }
  }, [availableModules.cm, state.moduleType, send]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  const { isFavorite } = favorites;
  const displayOperators = useMemo(
    () => showFavoritesOnly
      ? operators.filter((op) => isFavorite(op.id))
      : operators,
    [operators, showFavoritesOnly, isFavorite],
  );

  return (
    <div className="app">
      <div className="header">
        <h1>CSM Dev Wallet</h1>
        <NetworkSelector
          chainId={state.chainId}
          forkedFrom={anvilStatus.forkedFrom}
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
          chainId={state.chainId}
          label={state.addressLabels[state.selectedAddress.address.toLowerCase()] ?? ''}
          onDisconnect={() => send({ type: 'disconnect' })}
        />
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="tabs">
        {(['operators', 'manual', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => { setTab(t); clearError(); }}
          >
            {t === 'operators' ? 'Operators' : t === 'manual' ? 'Manual' : 'Settings'}
          </button>
        ))}
      </div>

      <div className="content">
        {tab === 'operators' && (
          <>
            <div className="search-wrapper">
              <input
                className="search-bar"
                placeholder="Search by #ID, address, label, or type..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="search-clear" onClick={() => setSearch('')}>×</button>
              )}
            </div>
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
            {state.chainId === ANVIL_CHAIN_ID && !anvilStatus.forkedFrom && !loading && (
              <div className="empty-state">
                Anvil not detected.<br />
                Start a local fork to browse operators.
              </div>
            )}
            <OperatorList
              operators={displayOperators}
              allOperatorsCount={allOperators.length}
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
