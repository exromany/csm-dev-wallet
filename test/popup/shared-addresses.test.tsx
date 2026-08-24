import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharedAddresses } from '../../entrypoints/popup/SharedAddresses.js';
import { buildAttachmentIndex, sharedAddresses } from '../../lib/shared/attachments.js';
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
  const utils = render(
    <SharedAddresses
      addresses={addresses}
      loading={false}
      lastFetchedAt={null}
      cmMissing={false}
      addressLabels={{}}
      siteModuleType="csm"
      onRefresh={() => {}}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...utils, onSelect };
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
    fireEvent.click(cmRow.querySelector('.attach-use')!);
    expect(onSelect).toHaveBeenCalledWith(ADDR_A, '7', 'manager', 'cm');
  });

  it('marks the connected attachment as in use rather than selectable', () => {
    const { container } = renderTab({
      selectedAddress: ADDR_A,
      selectedOperatorId: '7',
      siteModuleType: 'cm',
    });
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    const cmRow = [...container.querySelectorAll('.attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    expect(cmRow.querySelector('.attach-here')).toBeTruthy();
    expect(cmRow.querySelector('.attach-use')).toBeNull();
  });

  it('does not confuse CSM #7 with CM #7', () => {
    const both = sharedAddresses(
      buildAttachmentIndex({
        csm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
        cm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
      }),
    );
    const { container } = renderTab({
      addresses: both,
      selectedAddress: ADDR_A,
      selectedOperatorId: '7',
      siteModuleType: 'cm',
    });
    fireEvent.click(container.querySelectorAll('.addr-head')[0]);
    expect(container.querySelectorAll('.attach-here')).toHaveLength(1);
    expect(container.querySelectorAll('.attach-use')).toHaveLength(1);
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
});
