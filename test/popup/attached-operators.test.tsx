import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachedOperators } from '../../entrypoints/popup/AttachedOperators.js';
import { buildAttachmentIndex } from '../../lib/shared/attachments.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C } from '../fixtures.js';

function entryFor(address: string, byModule: Parameters<typeof buildAttachmentIndex>[0]) {
  return buildAttachmentIndex(byModule).get(address.toLowerCase())!;
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof AttachedOperators>> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <AttachedOperators
      loading={false}
      siteModuleType="csm"
      operatorLabel={() => ''}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { ...utils, onSelect };
}

describe('AttachedOperators', () => {
  it('renders nothing when there is no entry and not loading', () => {
    const { container } = renderPanel({ entry: undefined, loading: false });
    expect(container.firstChild).toBeNull();
  });

  it('renders the pending pill while loading with no entry', () => {
    const { container } = renderPanel({ entry: undefined, loading: true });
    const pill = container.querySelector('.pending-count');
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toBe('⋯');
  });

  it('keeps rendering a known count (not the pending pill) during a refresh', () => {
    const entry = entryFor(ADDR_A, { csm: [makeOperator({ id: '12', managerAddress: ADDR_A })] });
    const { container } = renderPanel({ entry, loading: true });
    expect(container.querySelector('.pending-count')).not.toBeInTheDocument();
    expect(container.querySelector('.ops-trigger')).toBeTruthy();
    expect(screen.getByText(/1 op\b/)).toBeInTheDocument();
  });

  it('renders "1 op" for a single attachment', () => {
    const entry = entryFor(ADDR_A, { csm: [makeOperator({ id: '12', managerAddress: ADDR_A })] });
    renderPanel({ entry });
    expect(screen.getByText(/1 op\b/)).toBeInTheDocument();
  });

  it('renders "3 ops" for three attachments', () => {
    const entry = entryFor(ADDR_A, {
      csm: [
        makeOperator({ id: '12', managerAddress: ADDR_A }),
        makeOperator({ id: '57', managerAddress: ADDR_A }),
      ],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });
    renderPanel({ entry });
    expect(screen.getByText(/3 ops/)).toBeInTheDocument();
  });

  it('applies the cross class when the entry spans modules', () => {
    const entry = entryFor(ADDR_A, {
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A })],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });
    const { container } = renderPanel({ entry });
    expect(container.querySelector('.ops-trigger')!.classList.contains('cross')).toBe(true);
  });

  it('omits the cross class for a single-module entry', () => {
    const entry = entryFor(ADDR_A, { csm: [makeOperator({ id: '12', managerAddress: ADDR_A })] });
    const { container } = renderPanel({ entry });
    expect(container.querySelector('.ops-trigger')!.classList.contains('cross')).toBe(false);
  });

  it('lists every attachment with its operator id, type badge and role pills', () => {
    const entry = entryFor(ADDR_A, {
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
    });
    const { container } = renderPanel({ entry });
    const rows = container.querySelectorAll('.ops-pop .attach-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('#12')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('CSM·DEF')).toBeInTheDocument();
    expect(screen.getByText('CM·PO')).toBeInTheDocument();
    expect(container.querySelectorAll('.role-pill').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MGR').length).toBeGreaterThan(0);
  });

  it('calls onSelect with the attachment operatorId, primaryRole and moduleType on row click', () => {
    const entry = entryFor(ADDR_A, {
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_B })],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_C, operatorType: 'CM_PO' })],
    });
    const { container, onSelect } = renderPanel({ entry });
    const cmRow = [...container.querySelectorAll('.ops-pop .attach-row')].find((el) =>
      el.textContent?.includes('CM·PO'),
    )!;
    fireEvent.click(cmRow);
    expect(onSelect).toHaveBeenCalledWith('7', 'manager', 'cm');
  });

  it('is not capped at five attachments, and is capped at six', () => {
    const five = entryFor(ADDR_A, {
      csm: [1, 2, 3, 4, 5].map((id) => makeOperator({ id: String(id), managerAddress: ADDR_A })),
    });
    const { container: c5 } = renderPanel({ entry: five });
    expect(c5.querySelector('.ops-pop')!.classList.contains('capped')).toBe(false);

    const six = entryFor(ADDR_A, {
      csm: [1, 2, 3, 4, 5].map((id) => makeOperator({ id: String(id), managerAddress: ADDR_A })),
      cm: [makeOperator({ id: '6', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });
    const { container: c6 } = renderPanel({ entry: six });
    expect(c6.querySelector('.ops-pop')!.classList.contains('capped')).toBe(true);
  });

  it('does not cap a short list', () => {
    const entry = entryFor(ADDR_A, { csm: [makeOperator({ id: '12', managerAddress: ADDR_A })] });
    const { container } = renderPanel({ entry });
    expect(container.querySelector('.ops-pop')!.classList.contains('capped')).toBe(false);
  });

  it('renders operator labels as static text with no editable input', () => {
    const entry = entryFor(ADDR_A, { csm: [makeOperator({ id: '12', managerAddress: ADDR_A })] });
    const { container } = renderPanel({ entry, operatorLabel: () => 'Kiln' });
    const label = screen.getByText('Kiln');
    fireEvent.click(label);
    expect(container.querySelector('.operator-label-input')).not.toBeInTheDocument();
  });
});
