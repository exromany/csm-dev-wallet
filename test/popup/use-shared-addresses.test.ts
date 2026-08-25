import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSharedAddresses, filterSharedAddresses } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';
import type { PopupEvent, PopupCommand, ModuleAvailability } from '../../lib/shared/messages.js';
import { buildAttachmentIndex, sharedAddresses } from '../../lib/shared/attachments.js';

const TEST_ORIGIN = 'https://example.com';

describe('useSharedAddresses', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  // availableModules has no default — {} ("nothing known yet") and a fully
  // resolved map are distinct cases here, so callers must always be explicit.
  const ALL_AVAILABLE: ModuleAvailability = { csm: true, cm: true, csm02: true };
  const CM_MISSING: ModuleAvailability = { csm: true, cm: false, csm02: false };
  // csm02 resolved-but-absent (a network without it), so these behaviour tests
  // stay focused on the csm/cm interplay they were written for.
  const TWO_MODULE: ModuleAvailability = { csm: true, cm: true, csm02: false };
  const render = (availableModules: ModuleAvailability, enabled = true) =>
    renderHook(() =>
      useSharedAddresses(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, availableModules, enabled),
    );

  it('requests operators for every available module', () => {
    render(ALL_AVAILABLE);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'csm02', 'cm']);
  });

  it('requests CSM only when the others are unavailable, and reports them missing', () => {
    const { result } = render(CM_MISSING);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm']);
    expect(result.current.missingModules).toEqual(['csm02', 'cm']);
  });

  it('holds off every request until every module availability is known, and stays loading', () => {
    const { result } = render({});
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests).toHaveLength(0);
    expect(result.current.loading).toBe(true);
    expect(result.current.missingModules).toEqual([]);
  });

  it('holds off when one probed module is still unresolved, even if others answered', () => {
    const { result } = render({ csm: true, cm: true, csm02: undefined });
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests).toHaveLength(0);
    expect(result.current.loading).toBe(true);
  });

  it('does not request anything while disabled', () => {
    render(ALL_AVAILABLE, false);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    expect(sent.filter((c) => c.type === 'request-operators')).toHaveLength(0);
  });

  it('stays loading until every requested module has answered', () => {
    const { result } = render(TWO_MODULE);
    expect(result.current.loading).toBe(true);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(true);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(false);
  });

  it('clears loading when a requested module fails instead of updating', () => {
    const { result } = render(TWO_MODULE);
    expect(result.current.loading).toBe(true);

    act(() => {
      port._emit({ type: 'operators-loading', chainId: 1, moduleType: 'csm', loading: true } satisfies PopupEvent);
      port._emit({ type: 'operators-loading', chainId: 1, moduleType: 'cm', loading: true } satisfies PopupEvent);
    });
    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
      port._emit({ type: 'operators-loading', chainId: 1, moduleType: 'csm', loading: false } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(true);

    // CM fails: loading:false with no operators-update ever arriving for it.
    act(() => {
      port._emit({ type: 'operators-loading', chainId: 1, moduleType: 'cm', loading: false } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(false);
  });

  it('reports lastFetchedAt as null when a settled module never sent an operators-update', () => {
    const { result } = render(TWO_MODULE);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
      // CM fails: settles via loading:false with no operators-update.
      port._emit({ type: 'operators-loading', chainId: 1, moduleType: 'cm', loading: false } satisfies PopupEvent);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.lastFetchedAt).toBeNull();
  });

  it('indexes across both modules and reports the stalest fetch time', () => {
    const { result } = render(TWO_MODULE);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });

    expect(result.current.addresses).toHaveLength(1);
    expect(result.current.addresses[0].address.toLowerCase()).toBe(ADDR_A.toLowerCase());
    expect(result.current.addresses[0].crossModule).toBe(true);
    expect(result.current.lastFetchedAt).toBe(1000);
  });

  it('exposes a raw index keyed by lowercased address, including single-attachment addresses that `addresses` omits', () => {
    const { result } = render(TWO_MODULE);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
    });

    // ADDR_B is only rewardsAddress on csm#12 — one attachment, so `addresses` drops it.
    expect(result.current.addresses.some((e) => e.address.toLowerCase() === ADDR_B.toLowerCase())).toBe(false);

    const entry = result.current.index.get(ADDR_B.toLowerCase());
    expect(entry).toBeDefined();
    expect(entry!.attachments).toHaveLength(1);

    const upperKey = result.current.index.get(ADDR_B.toUpperCase());
    expect(upperKey).toBeUndefined();
  });

  it('re-derives the stalest fetch time on refresh instead of ratcheting down', () => {
    const { result } = render(TWO_MODULE);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 1000,
      } satisfies PopupEvent);
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
    });
    expect(result.current.lastFetchedAt).toBe(1000);

    act(() => {
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 9000,
      } satisfies PopupEvent);
      port._emit({
        type: 'operators-update', chainId: 1, moduleType: 'cm',
        operators: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
        lastFetchedAt: 9000,
      } satisfies PopupEvent);
    });
    expect(result.current.lastFetchedAt).toBe(9000);
  });

  it('ignores events for a different chain', () => {
    const { result } = render(TWO_MODULE);
    act(() => {
      port._emit({
        type: 'operators-update', chainId: 560048, moduleType: 'csm',
        operators: [makeOperator({ id: '12', managerAddress: ADDR_A })],
        lastFetchedAt: 2000,
      } satisfies PopupEvent);
    });
    expect(result.current.addresses).toEqual([]);
  });
});

describe('filterSharedAddresses', () => {
  const list = sharedAddresses(
    buildAttachmentIndex({
      csm: [
        makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B}),
        makeOperator({ id: '57', managerAddress: ADDR_B, rewardsAddress: ADDR_C}),
      ],
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' }),
        makeOperator({ id: '44', managerAddress: ADDR_C, rewardsAddress: ADDR_B, proposedManagerAddress: ADDR_B, operatorType: 'CM_EEO' }),
      ],
    }),
  );

  it('passes everything through on the all scope', () => {
    expect(filterSharedAddresses(list, '', 'all')).toHaveLength(list.length);
  });

  it('keeps only cross-module addresses on the cross scope', () => {
    const out = filterSharedAddresses(list, '', 'cross');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((e) => e.crossModule)).toBe(true);
  });

  it('keeps only addresses holding a proposed role on the pending scope', () => {
    const out = filterSharedAddresses(list, '', 'pending');
    expect(out).toHaveLength(1);
    expect(out[0].address.toLowerCase()).toBe(ADDR_B.toLowerCase());
  });

  it('matches an address substring', () => {
    const out = filterSharedAddresses(list, ADDR_A.slice(0, 8), 'all');
    expect(out).toHaveLength(1);
    expect(out[0].address.toLowerCase()).toBe(ADDR_A.toLowerCase());
  });

  it('matches an address label', () => {
    const labels = { [ADDR_C.toLowerCase()]: 'ops treasury' };
    const out = filterSharedAddresses(list, 'treasury', 'all', labels);
    expect(out).toHaveLength(1);
    expect(out[0].address.toLowerCase()).toBe(ADDR_C.toLowerCase());
  });

  it('matches an exact operator id with #', () => {
    const out = filterSharedAddresses(list, '#44', 'all');
    expect(out.every((e) => e.attachments.some((a) => a.operatorId === '44'))).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });
});
