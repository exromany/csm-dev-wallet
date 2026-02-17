---
date: 2026-02-17
topic: replace-sdk-with-viem
---

# Replace lido-csm-sdk with direct viem calls + operator type display

## What We're Building

Remove heavy SDK class initialization (`LidoSDKCore` + `LidoSDKCsm`/`LidoSDKCm`) from the background service worker. Instead, use viem's `createPublicClient` + `readContract` with `SMDiscoveryAbi` and contract addresses already exported from `@lidofinance/lido-csm-sdk/common`. Add `operatorType` field (derived from `curveId` via `getOperatorTypeByCurveId`) to each cached operator.

## Why This Approach

The extension only uses one SDK method: `sdk.discovery.getAllNodeOperators()`. Initializing the full SDK stack (`LidoSDKCore` -> `CoreSDK` -> `DiscoverySDK` with bus registry, caching layer, version checks) is overkill. A single `readContract` call with the ABI achieves the same result with zero initialization overhead.

**Approaches considered:**

1. **Keep SDK, just add operatorType** — minimal change but keeps unnecessary weight
2. **Direct viem calls with SDK's ABI/constants** (chosen) — lightweight, still leverages SDK's ABI and address exports so no manual ABI maintenance
3. **Full extraction (copy ABI inline)** — removes SDK dependency entirely but creates maintenance burden for ABI/address updates

Approach 2 hits the sweet spot: no SDK initialization, but still benefits from SDK package updates for ABIs and contract addresses.

## Key Decisions

- **Delete `sdk-manager.ts`**: No longer needed — viem client created per-fetch (stateless, no caching needed)
- **Keep `@lidofinance/lido-csm-sdk` as dependency**: Only use `common` (constants, types, curve-id maps) and `abi` subpaths — lightweight re-exports, no class instantiation
- **Remove `@lidofinance/lido-ethereum-sdk` from app code**: Replaced `CHAINS` enum with local `CHAIN_ID` constant (`{ Mainnet: 1, Hoodi: 560048 }`)
- **Inline `resolveOperatorType`**: `getOperatorTypeByCurveId` isn't exported from `common` subpath, so we inline the 3-line lookup using the exported `CSM_OPERATOR_TYPE_CURVE_ID` / `CM_OPERATOR_TYPE_CURVE_ID` maps
- **Pagination**: Simple `while` loop with 500-operator batches, break when `batch.length < BATCH_SIZE` — replaces SDK's `iteratePages` + `byTotalCount` (which required an extra RPC call for operator count)
- **`clearSDK` removed**: No SDK instance cache to invalidate on network/RPC changes — viem client is created fresh each fetch

## Files Changed

| File | Change |
|------|--------|
| `lib/background/sdk-manager.ts` | **Deleted** |
| `lib/background/operator-cache.ts` | Rewritten: viem `readContract` + `resolveOperatorType` |
| `lib/shared/types.ts` | `CachedOperator` gains `operatorType: string` |
| `lib/shared/networks.ts` | `CHAIN_ID` replaces `CHAINS` import |
| `entrypoints/background.ts` | Removed `clearSDK` import/calls |
| `entrypoints/popup/OperatorList.tsx` | Shows operator type badge |
| `entrypoints/popup/NetworkSelector.tsx` | `CHAIN_ID` instead of `CHAINS` |
| `entrypoints/popup/Settings.tsx` | `CHAIN_ID` instead of `CHAINS` |
| `lib/background/anvil.ts` | `CHAIN_ID` instead of `CHAINS` |

## Open Questions

- Should `@lidofinance/lido-ethereum-sdk` be removed from `package.json` entirely? (currently only used transitively by csm-sdk)
- Operator type display styling — currently just text, may want colored badges per type
