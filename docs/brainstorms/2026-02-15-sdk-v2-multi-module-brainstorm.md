---
date: 2026-02-15
topic: sdk-v2-multi-module-cache-refactor
---

# SDK v2 Upgrade + Multi-Module Support + Smart Cache

## What We're Building

Upgrade `@lidofinance/lido-csm-sdk` from `^0.2.0` to `2.0.0-alpha.6` and refactor the extension to:

1. **Multi-module support** — after selecting a network, user picks a staking module (CSM or CM). Each module×network has its own operator list.
2. **Discovery-based operator loading** — replace manual batch-fetch with `DiscoverySDK.getAllNodeOperators()` which handles pagination internally via the shared `SMDiscovery` contract.
3. **Dynamic CM availability** — detect CM presence by attempting discovery query; hide CM option if module not deployed on current network.
4. **Smart cache with staleness tracking** — don't refetch on every popup open. Cache per module×network with `lastFetchedAt` timestamp. Auto-refresh only if stale (>30 min). Show "Updated X min ago" in UI. Manual refresh button.

## Why This Approach

**Discovery over manual batching:** The v2 SDK's `DiscoverySDK.getAllNodeOperators()` handles pagination (500/page default), eliminates our custom batch logic, and returns richer data (`curveId`, proposed addresses) in a single call through the on-chain `SMDiscovery` contract.

**Dynamic CM detection over hardcoding:** CM will roll out to testnets/mainnet progressively. Checking discovery for operators is forward-compatible — no code changes needed when CM deploys to new networks.

**Per module×network cache over global:** Only fetch what the user is looking at. Switching from CSM→CM on Hoodi shouldn't trigger a refetch for CSM on Mainnet.

## Key Decisions

- **CM detection:** Try `getAllNodeOperators` for CM; if fails or returns 0 operators, mark CM as unavailable for that network. Cache availability status too.
- **Module switch clears selection:** Always clear selected address when switching modules. Simple, predictable.
- **Favorites scoped per module+network:** Stored as `"csm:1:42"` / `"cm:17000:7"` format. No cross-contamination.
- **Cache key:** `operators_${moduleType}_${chainId}` with metadata `{ operators, lastFetchedAt, moduleAvailable }`.
- **Stale threshold:** 30 minutes. Configurable later if needed.
- **Refetch scope:** Only current module×network combo on manual refresh or stale detection.
- **SDK classes:** Use `LidoSDKCsm` for CSM, `LidoSDKCm` for CM — both provide `.discovery.getAllNodeOperators()`.

## Data Model Changes

### WalletState additions
```typescript
{
  // existing fields...
  moduleType: 'csm' | 'cm';  // NEW: currently selected module
  favorites: string[];         // CHANGED: format "csm:1:42" (module:chainId:operatorId)
}
```

### Cache storage
```typescript
// Key: `operators_${moduleType}_${chainId}`
// Value:
{
  operators: CachedOperator[];
  lastFetchedAt: number;  // Date.now()
}

// Key: `module_available_${moduleType}_${chainId}`
// Value: boolean
```

### CachedOperator type update (from NodeOperatorDiscoveryInfo)
```typescript
type CachedOperator = {
  id: string;
  managerAddress: Address;
  rewardsAddress: Address;     // renamed from rewardAddress
  proposedManagerAddress?: Address;
  proposedRewardsAddress?: Address;  // renamed from proposedRewardAddress
  extendedManagerPermissions: boolean;
  ownerAddress: Address;       // derived
  curveId: string;             // NEW from discovery
};
```

## Open Questions

- Should the stale threshold (30 min) be configurable in Settings?
- Should we show CM operator count in the module selector tab (e.g., "CM (42 operators)")?

## Next Steps

→ `/workflows:plan` for implementation details
