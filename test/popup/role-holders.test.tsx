import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { RoleHolders } from '../../entrypoints/popup/RoleHolders.js';
import type { CachedRole } from '../../lib/shared/types.js';
import { ADDR_A, ADDR_B } from '../fixtures.js';

const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';
const TOPUP = 'ENABLE_TOP_UP_ALLOCATION_ROLE';

const ROLES: CachedRole[] = [
  {
    role: PENALTY,
    holders: [
      { address: ADDR_A, isContract: false },
      { address: ADDR_B, isContract: true },
    ],
  },
  { role: TOPUP, holders: [] },
];

function setup(overrides: Partial<React.ComponentProps<typeof RoleHolders>> = {}) {
  const props = {
    roles: ROLES,
    loading: false,
    lastFetchedAt: null,
    addressLabels: {},
    onSelect: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
  render(<RoleHolders {...props} />);
  return props;
}

describe('RoleHolders', () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
  });

  it('renders a header per role with holder count', () => {
    setup();
    const headers = [...document.querySelectorAll('.role-group summary')].map((s) => s.textContent);
    expect(headers).toEqual([`${PENALTY}2`, `${TOPUP}0`]);
  });

  it('tags holders as contract or EOA, without a module tag', () => {
    setup();
    const rows = [...document.querySelectorAll('.role-group .manual-entry')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.role-pill.kind')!.textContent).toBe('EOA');
    expect(rows[1]!.querySelector('.role-pill.kind')!.textContent).toBe('contract');
    expect(document.querySelectorAll('.role-pill')).toHaveLength(2);
  });

  it('shows no tag when contract status is unknown', () => {
    setup({ roles: [{ role: PENALTY, holders: [{ address: ADDR_A }] }] });
    expect(document.querySelectorAll('.role-group .manual-entry')).toHaveLength(1);
    expect(document.querySelector('.role-pill.kind')).toBeNull();
  });

  it('shows the address label when one is set', () => {
    setup({ addressLabels: { [ADDR_A.toLowerCase()]: 'Penalty bot' } });
    expect(screen.getByText('Penalty bot')).toBeTruthy();
  });

  it('selects a holder with its role', () => {
    const { onSelect } = setup();
    fireEvent.click(document.querySelectorAll('.role-group .manual-entry')[1]!);
    expect(onSelect).toHaveBeenCalledWith(ADDR_B, PENALTY);
  });

  it('copying does not select', () => {
    const { onSelect } = setup();
    fireEvent.click(document.querySelector('.role-group .manual-entry .btn-copy')!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('flags an errored role with the message as hint', () => {
    setup({ roles: [{ role: PENALTY, holders: [], error: 'rpc down' }] });
    const note = document.querySelector('.role-note.error')!;
    expect(note.textContent).toBe('⚠ failed to load');
    expect(note.getAttribute('data-hint')).toBe('rpc down');
  });

  it('says so when a role has no holders', () => {
    setup();
    expect(screen.getByText('no holders')).toBeTruthy();
  });

  it('marks the connected holder, case-insensitively', () => {
    setup({ selectedAddress: ADDR_A.toLowerCase() });
    const rows = document.querySelectorAll('.role-group .manual-entry');
    expect(rows[0]!.classList.contains('selected')).toBe(true);
    expect(rows[1]!.classList.contains('selected')).toBe(false);
  });

  it('shows an empty state once loaded with no roles', () => {
    setup({ roles: [] });
    expect(screen.getByText('No protocol roles for this module on this network.')).toBeTruthy();
  });

  it('shows the loading state while nothing has arrived', () => {
    setup({ roles: [], loading: true });
    expect(screen.getByText('Loading role holders…')).toBeTruthy();
  });

  it('keeps rendering cached roles while refreshing', () => {
    setup({ loading: true });
    expect(document.querySelectorAll('.role-group')).toHaveLength(2);
    expect(screen.queryByText('Loading role holders…')).toBeNull();
  });

  it('shows when the roles were last updated', () => {
    setup({ lastFetchedAt: Date.now() - 5 * 60_000 });
    expect(document.querySelector('.staleness-label')!.textContent).toMatch(/^updated /);
  });

  it('omits the timestamp label before the first fetch', () => {
    setup();
    expect(document.querySelector('.staleness-label')).toBeNull();
  });

  it('refreshes on click', () => {
    const { onRefresh } = setup();
    fireEvent.click(screen.getByText('↻ refresh'));
    expect(onRefresh).toHaveBeenCalled();
  });
});
