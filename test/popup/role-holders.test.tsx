import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { RoleHolders } from '../../entrypoints/popup/RoleHolders.js';
import type { RoleGroup } from '../../lib/popup/hooks.js';
import { ADDR_A, ADDR_B } from '../fixtures.js';

const PENALTY = 'REPORT_GENERAL_DELAYED_PENALTY_ROLE';
const TOPUP = 'ENABLE_TOP_UP_ALLOCATION_ROLE';

const GROUPS: RoleGroup[] = [
  {
    role: PENALTY,
    entries: [
      { moduleType: 'csm', holders: [{ address: ADDR_A, isContract: false }] },
      { moduleType: 'cm', holders: [{ address: ADDR_B, isContract: true }] },
    ],
  },
  { role: TOPUP, entries: [{ moduleType: 'cm', holders: [] }] },
];

function setup(overrides: Partial<React.ComponentProps<typeof RoleHolders>> = {}) {
  const props = {
    groups: GROUPS,
    loading: false,
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

  it('renders a header per role with module scope and holder count', () => {
    setup();
    const headers = [...document.querySelectorAll('.role-group summary')].map((s) => s.textContent);
    expect(headers).toEqual([`${PENALTY}CSM · CM2`, `${TOPUP}CM0`]);
  });

  it('tags holders as contract or EOA', () => {
    setup();
    const rows = [...document.querySelectorAll('.role-group .manual-entry')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('CSM');
    expect(rows[0]!.querySelector('.role-pill.kind')!.textContent).toBe('EOA');
    expect(rows[1]!.querySelector('.role-pill.kind')!.textContent).toBe('contract');
  });

  it('shows no tag when contract status is unknown', () => {
    setup({ groups: [{ role: PENALTY, entries: [{ moduleType: 'cm', holders: [{ address: ADDR_A }] }] }] });
    expect(document.querySelectorAll('.role-group .manual-entry')).toHaveLength(1);
    expect(document.querySelector('.role-pill.kind')).toBeNull();
  });

  it('shows the address label when one is set', () => {
    setup({ addressLabels: { [ADDR_A.toLowerCase()]: 'Penalty bot' } });
    expect(screen.getByText('Penalty bot')).toBeTruthy();
  });

  it('selects a holder with its role and module', () => {
    const { onSelect } = setup();
    fireEvent.click(document.querySelectorAll('.role-group .manual-entry')[1]!);
    expect(onSelect).toHaveBeenCalledWith(ADDR_B, PENALTY, 'cm');
  });

  it('copying does not select', () => {
    const { onSelect } = setup();
    fireEvent.click(document.querySelector('.role-group .manual-entry .btn-copy')!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('flags an errored entry with the message as hint', () => {
    setup({ groups: [{ role: PENALTY, entries: [{ moduleType: 'cm', holders: [], error: 'rpc down' }] }] });
    const note = document.querySelector('.role-note.error')!;
    expect(note.textContent).toBe('CM ⚠');
    expect(note.getAttribute('data-hint')).toBe('rpc down');
  });

  it('says so when a module has no holders', () => {
    setup();
    expect(screen.getByText('CM — no holders')).toBeTruthy();
  });

  it('marks the connected holder, case-insensitively', () => {
    setup({ selectedAddress: ADDR_A.toLowerCase() });
    const rows = document.querySelectorAll('.role-group .manual-entry');
    expect(rows[0]!.classList.contains('selected')).toBe(true);
    expect(rows[1]!.classList.contains('selected')).toBe(false);
  });

  it('shows an empty state once loaded with no roles', () => {
    setup({ groups: [] });
    expect(screen.getByText('No protocol roles on this network.')).toBeTruthy();
  });

  it('shows the loading state while nothing has arrived', () => {
    setup({ groups: [], loading: true });
    expect(screen.getByText('Loading role holders…')).toBeTruthy();
  });

  it('refreshes on click', () => {
    const { onRefresh } = setup();
    fireEvent.click(screen.getByText('↻ refresh'));
    expect(onRefresh).toHaveBeenCalled();
  });
});
