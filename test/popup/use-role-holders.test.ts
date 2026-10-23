import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoleHolders } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { ADDR_A, ADDR_B } from '../fixtures.js';
import type { PopupEvent, PopupCommand } from '../../lib/shared/messages.js';
import type { CachedRole, ModuleType } from '../../lib/shared/types.js';

const TEST_ORIGIN = 'https://example.com';
const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';
const A = { address: ADDR_A, isContract: false };
const B = { address: ADDR_B, isContract: true };

describe('useRoleHolders', () => {
  let port: MockPort;
  beforeEach(() => {
    port = createMockPort();
  });

  const render = (moduleType: ModuleType = 'csm', enabled = true) =>
    renderHook(
      (props: { moduleType: ModuleType; enabled: boolean }) =>
        useRoleHolders(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, props.moduleType, props.enabled),
      { initialProps: { moduleType, enabled } },
    );
  const sent = (type: string) =>
    port.postMessage.mock.calls.map(([c]) => c as PopupCommand).filter((c) => c.type === type);
  const update = (moduleType: ModuleType, roles: CachedRole[], chainId = 1, lastFetchedAt = 1) =>
    act(() => {
      port._emit({ type: 'roles-update', chainId, moduleType, roles, lastFetchedAt } satisfies PopupEvent);
    });

  it('requests roles for the current module only', () => {
    render('cm');
    expect(sent('request-roles')).toEqual([
      { type: 'request-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'cm' },
    ]);
  });

  it('re-requests when the module changes', () => {
    const { rerender } = render('csm');
    rerender({ moduleType: 'cm', enabled: true });
    expect(sent('request-roles').map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'cm']);
  });

  it('holds off while disabled', () => {
    render('csm', false);
    expect(sent('request-roles')).toHaveLength(0);
  });

  it('is loading until the module answers, then exposes roles and timestamp', () => {
    const { result } = render('csm');
    expect(result.current.loading).toBe(true);
    expect(result.current.lastFetchedAt).toBeNull();
    update('csm', [{ role: PENALTY, holders: [A] }], 1, 123);
    expect(result.current.loading).toBe(false);
    expect(result.current.roles).toEqual([{ role: PENALTY, holders: [A] }]);
    expect(result.current.lastFetchedAt).toBe(123);
  });

  it('ignores events for another module', () => {
    const { result } = render('csm');
    update('cm', [{ role: PENALTY, holders: [B] }]);
    expect(result.current.loading).toBe(true);
    expect(result.current.roles).toEqual([]);
  });

  it('counts a failed fetch (loading:false, no update) as answered', () => {
    const { result } = render('csm');
    act(() => {
      port._emit({ type: 'roles-loading', chainId: 1, moduleType: 'csm', loading: false } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(false);
  });

  it('ignores events for another chain', () => {
    const { result } = render('csm');
    update('csm', [{ role: PENALTY, holders: [A] }], 560048);
    expect(result.current.loading).toBe(true);
    expect(result.current.roles).toEqual([]);
  });

  it('refresh posts refresh-roles for the current module', () => {
    const { result } = render('cm');
    act(() => result.current.refresh());
    expect(sent('refresh-roles')).toEqual([
      { type: 'refresh-roles', origin: TEST_ORIGIN, chainId: 1, moduleType: 'cm' },
    ]);
  });
});
