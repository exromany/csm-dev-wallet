import { describe, it, expect } from 'vitest';
import { roleEntries, operatorKind } from '../../lib/shared/attachments.js';
import {
  attachmentTypeLabel,
  buildAttachmentIndex,
  sharedAddresses,
  moduleCounts,
  countLabel,
  roleHint,
  typeHint,
  countHint,
} from '../../lib/shared/attachments.js';
import { makeOperator, ADDR_A, ADDR_B, ADDR_C, ADDR_D } from '../fixtures.js';

describe('roleEntries', () => {
  it('returns manager and rewards, marking whichever is owner', () => {
    const op = makeOperator({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_B,
      ownerAddress: ADDR_A,
    });

    const entries = roleEntries(op);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      role: 'manager', label: 'MGR', tint: 'mgr', address: ADDR_A, proposed: false, owner: true,
    });
    expect(entries[1]).toMatchObject({
      role: 'rewards', label: 'RWD', tint: 'rwd', address: ADDR_B, proposed: false, owner: false,
    });
  });

  it('marks the rewards address as owner when it holds extended permissions', () => {
    const op = makeOperator({ id: '2', ownerAddress: ADDR_B, extendedManagerPermissions: false });
    const entries = roleEntries(op);
    expect(entries.find((e) => e.role === 'manager')?.owner).toBe(false);
    expect(entries.find((e) => e.role === 'rewards')?.owner).toBe(true);
  });

  it('appends proposed roles, never marking them owner', () => {
    const op = makeOperator({ id: '3', proposedManagerAddress: ADDR_C });
    const entries = roleEntries(op);
    expect(entries.map((e) => e.label)).toEqual(['MGR', 'RWD', 'P-MGR']);
    expect(entries[2]).toMatchObject({
      role: 'proposedManager', tint: 'mgr', address: ADDR_C, proposed: true, owner: false,
    });
  });

  it('omits proposed roles that are unset', () => {
    expect(roleEntries(makeOperator({ id: '4' })).some((e) => e.proposed)).toBe(false);
  });

  it('collapses both proposed roles when both are set', () => {
    const op = makeOperator({
      id: '5', proposedManagerAddress: ADDR_C, proposedRewardsAddress: ADDR_C,
    });
    expect(roleEntries(op).map((e) => e.label)).toEqual(['MGR', 'RWD', 'P-MGR', 'P-RWD']);
  });
});

describe('operatorKind', () => {
  it('lowercases and dashes the raw operator type', () => {
    expect(operatorKind('CSM_DEF')).toBe('csm-def');
    expect(operatorKind('CM_PO')).toBe('cm-po');
  });

  it('falls back to cc for an empty type', () => {
    expect(operatorKind('')).toBe('cc');
  });
});

describe('attachmentTypeLabel', () => {
  it('restores the module prefix that OperatorRow strips', () => {
    expect(attachmentTypeLabel('csm', 'CSM_DEF')).toBe('CSM·DEF');
    expect(attachmentTypeLabel('cm', 'CM_PO')).toBe('CM·PO');
  });

  it('qualifies the prefixless CC fallback with its cache module', () => {
    expect(attachmentTypeLabel('cm', 'CC')).toBe('CM·CC');
    expect(attachmentTypeLabel('csm', '')).toBe('CSM·CC');
  });
});

describe('buildAttachmentIndex', () => {
  it('collapses several roles on one operator into a single attachment', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '31', managerAddress: ADDR_A, rewardsAddress: ADDR_A, ownerAddress: ADDR_A })],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.attachments).toHaveLength(1);
    expect(entry?.attachments[0].pills.map((p) => p.label)).toEqual(['MGR', 'RWD']);
    expect(entry?.attachments[0].primaryRole).toBe('manager');
  });

  it('keeps CSM #7 and CM #7 as separate attachments', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CSM_DEF' })],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.attachments).toHaveLength(2);
    expect(entry?.attachments.map((a) => a.moduleType)).toEqual(['csm', 'cm']);
    expect(entry?.attachments.map((a) => a.typeLabel)).toEqual(['CSM·DEF', 'CM·PO']);
    expect(entry?.crossModule).toBe(true);
    expect(entry?.modules).toEqual(['csm', 'cm']);
  });

  it('counts a proposed role as an attachment and flags the address pending', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A })],
      cm: [makeOperator({ id: '44', managerAddress: ADDR_B, rewardsAddress: ADDR_C, proposedManagerAddress: ADDR_A, operatorType: 'CM_EEO' })],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.attachments).toHaveLength(2);
    expect(entry?.pending).toBe(true);
    expect(entry?.attachments[1].pills[0].label).toBe('P-MGR');
    expect(entry?.attachments[1].primaryRole).toBe('proposedManager');
  });

  it('leaves same-module addresses not cross-module and not pending', () => {
    const index = buildAttachmentIndex({
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '23', managerAddress: ADDR_A, operatorType: 'CM_PGO' }),
      ],
    });

    const entry = index.get(ADDR_A.toLowerCase());
    expect(entry?.crossModule).toBe(false);
    expect(entry?.pending).toBe(false);
    expect(entry?.modules).toEqual(['cm']);
  });

  it('carries the ribbon kind for each attachment', () => {
    const index = buildAttachmentIndex({ csm: [makeOperator({ id: '42', managerAddress: ADDR_A, operatorType: 'CSM_LEA' })] });
    expect(index.get(ADDR_A.toLowerCase())?.attachments[0].kind).toBe('csm-lea');
  });

  it('carries the curve id for each attachment', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '42', managerAddress: ADDR_A })],
      cm: [makeOperator({ id: '43', managerAddress: ADDR_A, curveId: '5', operatorType: 'CM_PO' })],
    });
    const attachments = index.get(ADDR_A.toLowerCase())?.attachments;
    expect(attachments?.[0].curveId).toBe('0');
    expect(attachments?.[1].curveId).toBe('5');
  });
});

describe('sharedAddresses', () => {
  const index = buildAttachmentIndex({
    csm: [
      makeOperator({ id: '12', managerAddress: ADDR_A, rewardsAddress: ADDR_D, ownerAddress: ADDR_A }),
      makeOperator({ id: '57', managerAddress: ADDR_D, rewardsAddress: ADDR_A, ownerAddress: ADDR_D }),
    ],
    cm: [
      makeOperator({ id: '7', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_A, operatorType: 'CM_PO' }),
      makeOperator({ id: '31', managerAddress: ADDR_C, rewardsAddress: ADDR_C, ownerAddress: ADDR_C, operatorType: 'CM_DO' }),
    ],
  });

  it('drops addresses attached to only one operator', () => {
    const list = sharedAddresses(index);
    const addresses = list.map((e) => e.address.toLowerCase());
    expect(addresses).not.toContain(ADDR_B.toLowerCase());
    expect(addresses).not.toContain(ADDR_C.toLowerCase());
  });

  it('sorts by attachment count descending', () => {
    const list = sharedAddresses(index);
    expect(list[0].address.toLowerCase()).toBe(ADDR_A.toLowerCase());
    expect(list[0].attachments).toHaveLength(3);
    expect(list[1].attachments).toHaveLength(2);
  });
});

describe('countLabel', () => {
  it('names both modules when the address spans them', () => {
    const index = buildAttachmentIndex({
      csm: [
        makeOperator({ id: '12', managerAddress: ADDR_A }),
        makeOperator({ id: '57', managerAddress: ADDR_A, operatorType: 'CSM_ICS' }),
      ],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });
    const entry = index.get(ADDR_A.toLowerCase())!;
    expect(moduleCounts(entry)).toEqual({ csm: 2, cm: 1 });
    expect(countLabel(entry)).toBe('2 CSM · 1 CM');
  });

  it('names one module when the address does not span', () => {
    const index = buildAttachmentIndex({
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '23', managerAddress: ADDR_A, operatorType: 'CM_PGO' }),
      ],
    });
    expect(countLabel(index.get(ADDR_A.toLowerCase())!)).toBe('2 CM');
  });
});

describe('roleHint', () => {
  it('describes a plain manager address', () => {
    const op = makeOperator({ id: '1', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_D });
    const entry = roleEntries(op).find((e) => e.role === 'manager')!;
    expect(roleHint(entry)).toBe('Manager address');
  });

  it('describes a plain rewards address', () => {
    const op = makeOperator({ id: '1', managerAddress: ADDR_A, rewardsAddress: ADDR_B, ownerAddress: ADDR_D });
    const entry = roleEntries(op).find((e) => e.role === 'rewards')!;
    expect(roleHint(entry)).toBe('Rewards address');
  });

  it('appends the owner suffix for an owner manager', () => {
    const op = makeOperator({ id: '2', managerAddress: ADDR_A, ownerAddress: ADDR_A });
    const entry = roleEntries(op).find((e) => e.role === 'manager')!;
    expect(roleHint(entry)).toBe('Manager address · owner — holds extended manager permissions.');
  });

  it('appends the owner suffix for an owner rewards', () => {
    const op = makeOperator({ id: '3', ownerAddress: ADDR_B });
    const entry = roleEntries(op).find((e) => e.role === 'rewards')!;
    expect(roleHint(entry)).toBe('Rewards address · owner — holds extended manager permissions.');
  });

  it('describes a proposed manager address, never as owner', () => {
    const op = makeOperator({ id: '4', proposedManagerAddress: ADDR_C });
    const entry = roleEntries(op).find((e) => e.role === 'proposedManager')!;
    expect(roleHint(entry)).toBe('Proposed manager address — pending');
  });

  it('describes a proposed rewards address, never as owner', () => {
    const op = makeOperator({ id: '5', proposedRewardsAddress: ADDR_C });
    const entry = roleEntries(op).find((e) => e.role === 'proposedRewards')!;
    expect(roleHint(entry)).toBe('Proposed rewards address — pending');
  });
});

describe('typeHint', () => {
  it('shows the raw enum name and its curve id', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '1', managerAddress: ADDR_A, operatorType: 'CSM_DEF', curveId: '0' })],
    });
    expect(typeHint(index.get(ADDR_A.toLowerCase())!.attachments[0])).toBe('CSM_DEF · curve id 0');
  });

  it('handles the CC fallback the same as any other type', () => {
    const index = buildAttachmentIndex({
      cm: [makeOperator({ id: '2', managerAddress: ADDR_A, operatorType: 'CC', curveId: '5' })],
    });
    expect(typeHint(index.get(ADDR_A.toLowerCase())!.attachments[0])).toBe('CC · curve id 5');
  });
});

describe('countHint', () => {
  it('adds the cross-module clause when the address spans both modules', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A })],
      cm: [makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' })],
    });
    expect(countHint(index.get(ADDR_A.toLowerCase())!)).toBe(
      'Attached to 1 CSM operator and 1 CM operator — spans both modules.',
    );
  });

  it('omits the cross-module clause for a single-module address', () => {
    const index = buildAttachmentIndex({
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '23', managerAddress: ADDR_A, operatorType: 'CM_PGO' }),
      ],
    });
    expect(countHint(index.get(ADDR_A.toLowerCase())!)).toBe('Attached to 2 CM operators.');
  });

  it('pluralises each module count independently', () => {
    const index = buildAttachmentIndex({
      csm: [makeOperator({ id: '12', managerAddress: ADDR_A })],
      cm: [
        makeOperator({ id: '7', managerAddress: ADDR_A, operatorType: 'CM_PO' }),
        makeOperator({ id: '23', managerAddress: ADDR_A, operatorType: 'CM_PGO' }),
      ],
    });
    expect(countHint(index.get(ADDR_A.toLowerCase())!)).toBe(
      'Attached to 1 CSM operator and 2 CM operators — spans both modules.',
    );
  });
});
