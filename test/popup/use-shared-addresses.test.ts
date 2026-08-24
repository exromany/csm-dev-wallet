import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSharedAddresses, filterSharedAddresses } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';
import type { PopupEvent, PopupCommand } from '../../lib/shared/messages.js';
import { buildAttachmentIndex, sharedAddresses } from '../../lib/shared/attachments.js';

const TEST_ORIGIN = 'https://example.com';

describe('useSharedAddresses', () => {
  let port: MockPort;

  beforeEach(() => {
    port = createMockPort();
  });

  // cmAvailable has no default — undefined ("not known yet") and true are
  // distinct cases here, so callers must always be explicit.
  const render = (cmAvailable: boolean | undefined, enabled = true) =>
    renderHook(() =>
      useSharedAddresses(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, cmAvailable, enabled),
    );

  it('requests operators for both modules', () => {
    render(true);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'cm']);
  });

  it('requests CSM only when CM is unavailable, and reports it', () => {
    const { result } = render(false);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm']);
    expect(result.current.cmMissing).toBe(true);
  });

  it('holds off the CM request until availability is known', () => {
    const { result } = render(undefined);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    const requests = sent.filter((c) => c.type === 'request-operators');
    expect(requests.map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm']);
    expect(result.current.cmMissing).toBe(false);
  });

  it('does not request anything while disabled', () => {
    render(true, false);
    const sent = port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
    expect(sent.filter((c) => c.type === 'request-operators')).toHaveLength(0);
  });

  it('stays loading until every requested module has answered', () => {
    const { result } = render(true);
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
    const { result } = render(true);
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

  it('indexes across both modules and reports the stalest fetch time', () => {
    const { result } = render(true);

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

  it('re-derives the stalest fetch time on refresh instead of ratcheting down', () => {
    const { result } = render(true);

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
    const { result } = render(true);
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
        makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_A }),
        makeOperator({ id: '57', managerAddress: ADDR_B, rewardsAddress: ADDR_C, ownerAddress: ADDR_B }),
      ],
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, ownerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '44', managerAddress: ADDR_C, rewardsAddress: ADDR_B, ownerAddress: ADDR_C, proposedManagerAddress: ADDR_B, operatorType: 'CM_EEO' }),
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
