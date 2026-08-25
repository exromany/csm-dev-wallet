import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharedAddresses } from '../../entrypoints/popup/SharedAddresses.js';
import {
  buildAttachmentIndex,
  countHint,
  roleHint,
  sharedAddresses,
  typeHint,
} from '../../lib/shared/attachments.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C, ADDR_D } from '../fixtures.js';

// Four shared addresses, and deliberately only THREE of them cross-module, so the
// Cross-module chip has something to narrow away:
//   A → csm#12, csm#57, cm#7   (3) cross   "2 CSM · 1 CM"
//   C → csm#57, cm#7,  cm#44   (3) cross   "1 CSM · 2 CM"
//   B → csm#12, cm#23          (2) cross   "1 CSM · 1 CM"
//   D → cm#23,  cm#44          (2) CM only "2 CM"
const addresses = sharedAddresses(
  buildAttachmentIndex({
    csm: [
      makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_A }),
      makeOperator({ id: '57', managerAddress: ADDR_C, rewardsAddress: ADDR_A, ownerAddress: ADDR_C, operatorType: 'CSM_ICS' }),
    ],
    cm: [
      makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, ownerAddress: ADDR_A, operatorType: 'CM_PO' }),
      makeOperator({ id: '23', managerAddress: ADDR_D, rewardsAddress: ADDR_B, ownerAddress: ADDR_D, operatorType: 'CM_PGO' }),
      makeOperator({ id: '44', managerAddress: ADDR_D, rewardsAddress: ADDR_C, ownerAddress: ADDR_D, operatorType: 'CM_EEO' }),
    ],
  }),
);

function renderTab(overrides: Partial<React.ComponentProps<typeof SharedAddresses>> = {}) {
  const onSelect = vi.fn();
  const onSetAddressLabel = vi.fn();
  const operatorLabels = { get: () => '', set: vi.fn() };
  const utils = render(
    <SharedAddresses
      addresses={addresses}
      loading={false}
      lastFetchedAt={null}
      cmMissing={false}
      addressLabels={{}}
      operatorLabels={operatorLabels}
      siteModuleType="csm"
      onRefresh={() => {}}
      onSelect={onSelect}
      onSetAddressLabel={onSetAddressLabel}
      {...overrides}
    />,
  );
  return { ...utils, onSelect, onSetAddressLabel, operatorLabels };
}

describe('SharedAddresses', () => {
  it('renders one card per shared address', () => {
    const { container } = renderTab();
    expect(container.querySelectorAll('.addr-card')).toHaveLength(addresses.length);
  });

  it('shows a cross-module count for an address spanning both modules', () => {
    renderTab();
    expect(screen.getByText('2 CSM · 1 CM')).toBeInTheDocument();
  });

  it('expands a card to reveal its attachments with module-qualified types', () => {
    const { container } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    expect(screen.getByText('CSM·DEF')).toBeInTheDocument();
    expect(screen.getByText('CM·PO')).toBeInTheDocument();
  });

  it('passes the attachment module up on select', () => {
    const { container, onSelect } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const cmRow = [...container.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    fireEvent.click(cmRow);
    expect(onSelect).toHaveBeenCalledWith(ADDR_A, '7', 'manager', 'cm');
  });

  it('marks the connected address at the card level, leaving every attachment selectable', () => {
    const { container, onSelect } = renderTab({
      selectedAddress: ADDR_A,
      siteModuleType: 'cm',
    });
    const card = container.querySelectorAll('.addr-card')[0];
    expect(card.classList.contains('selected')).toBe(true);
    fireEvent.click(card.querySelector('.addr-head')!);
    const cmRow = [...card.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    fireEvent.click(cmRow);
    expect(onSelect).toHaveBeenCalledWith(ADDR_A, '7', 'manager', 'cm');
  });

  it('does not confuse CSM #7 with CM #7', () => {
    const both = sharedAddresses(
      buildAttachmentIndex({
        csm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
        cm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
      }),
    );
    const { container, onSelect } = renderTab({ addresses: both });
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const rows = container.querySelectorAll('.attach-row');
    expect(rows).toHaveLength(2);

    const csmRow = [...rows].find((el) => el.textContent?.includes('CSM·DEF'))!;
    fireEvent.click(csmRow);
    expect(onSelect).toHaveBeenLastCalledWith(ADDR_A, '7', 'manager', 'csm');

    const cmRow = [...rows].find((el) => el.textContent?.includes('CM·PO'))!;
    fireEvent.click(cmRow);
    expect(onSelect).toHaveBeenLastCalledWith(ADDR_A, '7', 'manager', 'cm');
  });

  it('narrows to cross-module addresses when the chip is clicked', () => {
    const { container } = renderTab();
    expect(container.querySelectorAll('.addr-card')).toHaveLength(4);
    fireEvent.click(screen.getByText('Cross-module'));
    // D is CM-only and drops out.
    expect(container.querySelectorAll('.addr-card')).toHaveLength(3);
  });

  it('tells the user when CM is unavailable', () => {
    renderTab({ cmMissing: true });
    expect(screen.getByText(/CM is not deployed/i)).toBeInTheDocument();
  });

  it('shows a spinner while any module is still loading', () => {
    const { container } = renderTab({ addresses: [], loading: true });
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('explains an empty result instead of rendering nothing', () => {
    renderTab({ addresses: [], loading: false });
    expect(screen.getByText(/No shared addresses/i)).toBeInTheDocument();
  });

  it('renders the operator label on an attachment row', () => {
    const operatorLabels = {
      get: (operatorId: string, moduleType: string) =>
        operatorId === '12' && moduleType === 'csm' ? 'Kiln' : '',
      set: vi.fn(),
    };
    const { container } = renderTab({ operatorLabels });
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    expect(screen.getByText('Kiln')).toBeInTheDocument();
  });

  it('shows "+ label" on an attachment row when the operator label is unset', () => {
    const { container } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const rows = container.querySelectorAll('.attach-row');
    expect(rows[0].querySelector('.operator-label.empty')).toBeInTheDocument();
  });

  it('saves an operator label from a CM attachment scoped to the cm module', () => {
    const { container, operatorLabels } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const cmRow = [...container.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    fireEvent.click(cmRow.querySelector('.operator-label')!);
    const input = cmRow.querySelector('.operator-label-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'P2P' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(operatorLabels.set).toHaveBeenCalledWith('7', 'P2P', 'cm');
  });

  it('saves an address label via onSetAddressLabel', () => {
    const { container, onSetAddressLabel } = renderTab();
    const head = container.querySelectorAll('.addr-head')[0];
    fireEvent.click(head.querySelector('.operator-label')!);
    const input = head.querySelector('.operator-label-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My wallet' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSetAddressLabel).toHaveBeenCalledWith(ADDR_A, 'My wallet');
  });

  it('does not toggle the card when the address label control is clicked', () => {
    const { container } = renderTab();
    const head = container.querySelectorAll('.addr-head')[0];
    fireEvent.click(head.querySelector('.operator-label')!);
    expect(container.querySelector('.addr-body')).not.toBeInTheDocument();
  });

  it('does not select the row when an attachment label control is clicked', () => {
    const { container, onSelect } = renderTab();
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const row = container.querySelectorAll('.attach-row')[0];
    fireEvent.click(row.querySelector('.operator-label')!);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('carries hint text from the shared attachments helpers', () => {
    const { container } = renderTab();
    const entry = addresses[0];
    const countPill = container.querySelector('.attach-count')!;
    expect(countPill.getAttribute('data-hint')).toBe(countHint(entry));

    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const csmRow = [...container.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CSM·DEF'),
    )!;
    const att = entry.attachments.find((a) => a.typeLabel === 'CSM·DEF')!;
    expect(csmRow.querySelector('.attach-type')!.getAttribute('data-hint')).toBe(typeHint(att));
    expect(csmRow.querySelector('.role-pill')!.getAttribute('data-hint')).toBe(
      roleHint(att.pills[0]),
    );
  });
});
