import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoleHolders, groupRoles } from '../../lib/popup/hooks.js';
import { createMockPort, type MockPort } from '../setup.js';
import { ADDR_A, ADDR_B } from '../fixtures.js';
import type { PopupEvent, PopupCommand, ModuleAvailability } from '../../lib/shared/messages.js';
import type { CachedRole } from '../../lib/shared/types.js';

const TEST_ORIGIN = 'https://example.com';
const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';
const TOPUP = 'ENABLE_TOP_UP_ALLOCATION_ROLE';
const A = { address: ADDR_A, isContract: false };
const B = { address: ADDR_B, isContract: true };

describe('groupRoles', () => {
  it('orders roles by registry and modules by display order', () => {
    const groups = groupRoles(
      {
        cm: [{ role: PENALTY, holders: [B] }, { role: TOPUP, holders: [B] }],
        csm: [{ role: PENALTY, holders: [A] }],
      },
      ['csm', 'cm'],
    );
    expect(groups).toEqual([
      { role: PENALTY, entries: [{ moduleType: 'csm', holders: [A] }, { moduleType: 'cm', holders: [B] }] },
      { role: TOPUP, entries: [{ moduleType: 'cm', holders: [B] }] },
    ]);
  });

  it('excludes modules that are not wanted', () => {
    const groups = groupRoles({ cm: [{ role: PENALTY, holders: [B] }], csm: [{ role: PENALTY, holders: [A] }] }, ['csm']);
    expect(groups).toEqual([{ role: PENALTY, entries: [{ moduleType: 'csm', holders: [A] }] }]);
  });

  it('keeps an errored role with its error and yields nothing for a module without roles', () => {
    const groups = groupRoles({ csm: [{ role: PENALTY, holders: [], error: 'boom' }], csm02: [] }, ['csm', 'csm02']);
    expect(groups).toEqual([{ role: PENALTY, entries: [{ moduleType: 'csm', holders: [], error: 'boom' }] }]);
  });
});

describe('useRoleHolders', () => {
  let port: MockPort;
  beforeEach(() => {
    port = createMockPort();
  });

  const TWO_MODULE: ModuleAvailability = { csm: true, cm: true, csm02: false };
  const render = (availableModules: ModuleAvailability, enabled = true) =>
    renderHook(() => useRoleHolders(port as unknown as chrome.runtime.Port, TEST_ORIGIN, 1, availableModules, enabled));
  const sent = () => port.postMessage.mock.calls.map(([c]) => c as PopupCommand);
  const update = (moduleType: 'csm' | 'cm', roles: CachedRole[], chainId = 1) =>
    act(() => {
      port._emit({ type: 'roles-update', chainId, moduleType, roles, lastFetchedAt: 1 } satisfies PopupEvent);
    });

  it('requests roles for every wanted module', () => {
    render(TWO_MODULE);
    expect(sent().filter((c) => c.type === 'request-roles').map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'cm']);
  });

  it('holds off until availability is resolved, and while disabled', () => {
    render({});
    render(TWO_MODULE, false);
    expect(sent().filter((c) => c.type === 'request-roles')).toHaveLength(0);
  });

  it('stays loading until every module has answered', () => {
    const { result } = render(TWO_MODULE);
    expect(result.current.loading).toBe(true);
    update('csm', [{ role: PENALTY, holders: [A] }]);
    expect(result.current.loading).toBe(true);
    update('cm', [{ role: PENALTY, holders: [B] }]);
    expect(result.current.loading).toBe(false);
    expect(result.current.groups).toHaveLength(1);
  });

  it('counts a failed fetch (loading:false, no update) as answered', () => {
    const { result } = render({ csm: true, cm: false, csm02: false });
    act(() => {
      port._emit({ type: 'roles-loading', chainId: 1, moduleType: 'csm', loading: false } satisfies PopupEvent);
    });
    expect(result.current.loading).toBe(false);
  });

  it('ignores events for another chain', () => {
    const { result } = render({ csm: true, cm: false, csm02: false });
    update('csm', [{ role: PENALTY, holders: [A] }], 560048);
    expect(result.current.loading).toBe(true);
    expect(result.current.groups).toEqual([]);
  });

  it('refresh posts refresh-roles per module', () => {
    const { result } = render(TWO_MODULE);
    act(() => result.current.refresh());
    expect(sent().filter((c) => c.type === 'refresh-roles').map((c) => (c as { moduleType: string }).moduleType)).toEqual(['csm', 'cm']);
  });
});
