import type { Address } from 'viem';
import type { AddressRole, CachedGate, CachedOperator, ModuleType } from './types.js';
import { MODULE_ORDER, MODULE_LABEL, MODULE_SHORT } from './modules.js';

export type RoleLabel = 'MGR' | 'RWD' | 'P-MGR' | 'P-RWD' | 'CLM';

export type RoleEntry = {
  role: AddressRole;
  label: RoleLabel;
  tint: 'mgr' | 'rwd' | 'clm';
  address: Address;
  proposed: boolean;
  owner: boolean;
};

/**
 * The (role, address) slots an operator holds — unset proposed/claimer roles omitted.
 * Exactly one of manager/rewards is the owner; never compare against an address,
 * since the two roles can share one and both would match.
 */
export function roleEntries(op: CachedOperator): RoleEntry[] {
  const managerOwns = op.extendedManagerPermissions;
  const entries: RoleEntry[] = [
    {
      role: 'manager', label: 'MGR', tint: 'mgr', address: op.managerAddress,
      proposed: false, owner: managerOwns,
    },
    {
      role: 'rewards', label: 'RWD', tint: 'rwd', address: op.rewardsAddress,
      proposed: false, owner: !managerOwns,
    },
  ];
  if (op.proposedManagerAddress) {
    entries.push({
      role: 'proposedManager', label: 'P-MGR', tint: 'mgr',
      address: op.proposedManagerAddress, proposed: true, owner: false,
    });
  }
  if (op.proposedRewardsAddress) {
    entries.push({
      role: 'proposedRewards', label: 'P-RWD', tint: 'rwd',
      address: op.proposedRewardsAddress, proposed: true, owner: false,
    });
  }
  if (op.claimerAddress) {
    entries.push({
      role: 'claimer', label: 'CLM', tint: 'clm',
      address: op.claimerAddress, proposed: false, owner: false,
    });
  }
  return entries;
}

/** 'CSM_LEA' → 'csm-lea' — drives per-type ribbon colour via CSS class. */
export function operatorKind(operatorType: string): string {
  return (operatorType || 'cc').toLowerCase().replace(/_/g, '-');
}

type AttachmentBase = {
  moduleType: ModuleType;
  operatorType: string; // raw, e.g. 'CSM_DEF' or the 'CC' fallback
  curveId: string; // BigInt kept as string end to end — chrome.storage can't hold BigInts
  typeLabel: string; // 'CSM·DEF' — module prefix restored for cross-module display
  kind: string; // 'csm-def' — ribbon colour class suffix
};

/** One operator an address is attached to, with every role it holds there. */
export type OperatorAttachment = AttachmentBase & {
  type: 'operator';
  operatorId: string;
  primaryRole: AddressRole; // role to attribute a selection to
  pills: RoleEntry[];
};

/** An unused proof for this address in a gate's merkle tree. Identity is (moduleType, gate). */
export type GateAttachment = AttachmentBase & {
  type: 'gate';
  gate: string;
  gateLabel: string;
  paused: boolean;
};

export type Attachment = OperatorAttachment | GateAttachment;

export type AddressAttachments = {
  address: Address;
  attachments: Attachment[];
  modules: ModuleType[];
  crossModule: boolean;
  pending: boolean; // holds at least one proposed role
  claimer: boolean; // holds a claimer role on any attachment
  gate: boolean; // holds an unused proof in at least one gate
};

export function attachmentKey(att: Attachment): string {
  return att.type === 'gate' ? `${att.moduleType}:gate:${att.gate}` : `${att.moduleType}:op:${att.operatorId}`;
}

/** 'CSM_DEF' → '0x01', 'CSM2_DEF' → '0x02', anything else → its prefix-stripped suffix. */
export function operatorTypeBadge(operatorType: string): string {
  const raw = operatorType || 'CC';
  if (raw === 'CSM_DEF') return '0x01';
  if (raw === 'CSM2_DEF') return '0x02';
  return raw.replace(/^(?:CSM2?|CM)_/, '');
}

/** 'CSM_DEF' → 'CSM·0x01'. The prefixless 'CC' fallback takes its cache module. */
export function attachmentTypeLabel(moduleType: ModuleType, operatorType: string): string {
  return `${MODULE_SHORT[moduleType]}·${operatorTypeBadge(operatorType)}`;
}

/** Matches a lowercased, trimmed, `@`-stripped query against an operator's raw type or badge. */
export function matchesTypeQuery(operatorType: string, q: string): boolean {
  if (!q) return false;
  const raw = (operatorType || 'CC').toLowerCase();
  const stripped = raw.replace(/^(?:csm2?|cm)_/, '');
  const badge = operatorTypeBadge(operatorType).toLowerCase();
  return q === raw || q === stripped || q === badge;
}

/**
 * Reverse index over one or both module caches: lowercased address → attachments.
 * Roles of the same address on the same operator collapse into one attachment;
 * the same operator id in different modules stays two. Gate proofs fold in as
 * a second kind of attachment, keyed on (moduleType, gate).
 */
export function buildAttachmentIndex(
  byModule: Partial<Record<ModuleType, CachedOperator[]>>,
  gatesByModule: Partial<Record<ModuleType, CachedGate[]>> = {},
): Map<string, AddressAttachments> {
  const index = new Map<string, AddressAttachments>();
  const entryFor = (address: Address) => {
    const key = address.toLowerCase();
    let entry = index.get(key);
    if (!entry) {
      entry = { address, attachments: [], modules: [], crossModule: false, pending: false, claimer: false, gate: false };
      index.set(key, entry);
    }
    return entry;
  };

  for (const moduleType of MODULE_ORDER) {
    for (const op of byModule[moduleType] ?? []) {
      const perAddress = new Map<string, OperatorAttachment>();
      for (const e of roleEntries(op)) {
        const key = e.address.toLowerCase();
        let att = perAddress.get(key);
        if (!att) {
          att = {
            type: 'operator',
            moduleType,
            operatorId: op.id,
            operatorType: op.operatorType,
            curveId: op.curveId,
            typeLabel: attachmentTypeLabel(moduleType, op.operatorType),
            kind: operatorKind(op.operatorType),
            primaryRole: e.role,
            pills: [],
          };
          perAddress.set(key, att);
        }
        att.pills.push(e);
      }
      for (const att of perAddress.values()) {
        const first = att.pills[0];
        if (first) entryFor(first.address).attachments.push(att);
      }
    }
  }

  // After every operator, so an address's operator rows always lead its gate rows.
  for (const moduleType of MODULE_ORDER) {
    for (const g of gatesByModule[moduleType] ?? []) {
      if (g.error) continue;
      for (const address of g.unconsumed) {
        entryFor(address).attachments.push({
          type: 'gate',
          moduleType,
          gate: g.gate,
          gateLabel: g.label,
          paused: g.paused,
          operatorType: g.operatorType,
          curveId: g.curveId,
          typeLabel: `${MODULE_SHORT[moduleType]}·${g.label}`,
          kind: operatorKind(g.operatorType),
        });
      }
    }
  }

  for (const entry of index.values()) {
    const ops = entry.attachments.filter((a): a is OperatorAttachment => a.type === 'operator');
    entry.modules = MODULE_ORDER.filter((m) => entry.attachments.some((a) => a.moduleType === m));
    entry.crossModule = entry.modules.length > 1;
    entry.pending = ops.some((a) => a.pills.some((p) => p.proposed));
    entry.claimer = ops.some((a) => a.pills.some((p) => p.role === 'claimer'));
    entry.gate = entry.attachments.length > ops.length;
  }

  return index;
}

/**
 * Addresses held by more than one attachment, or holding an unused gate proof,
 * with at least one attachment in `inModule` — most attachments first.
 */
export function sharedAddresses(
  index: Map<string, AddressAttachments>,
  inModule?: ModuleType,
): AddressAttachments[] {
  return [...index.values()]
    .filter((e) => e.attachments.length > 1 || e.gate)
    .filter((e) => !inModule || e.attachments.some((a) => a.moduleType === inModule))
    .sort(
      (a, b) =>
        b.attachments.length - a.attachments.length ||
        a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );
}

export function moduleCounts(entry: AddressAttachments): Partial<Record<ModuleType, number>> {
  const counts: Partial<Record<ModuleType, number>> = {};
  for (const a of entry.attachments) {
    if (a.type === 'operator') counts[a.moduleType] = (counts[a.moduleType] ?? 0) + 1;
  }
  return counts;
}

export function gateLabels(entry: AddressAttachments): string[] {
  return [...new Set(entry.attachments.flatMap((a) => (a.type === 'gate' ? [a.gateLabel] : [])))];
}

/** 'a' | 'a and b' | 'a, b and c' */
export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** '2 CSM · 1 CM', '2 CSM · ICS', 'ICS · PTO'. */
export function countLabel(entry: AddressAttachments): string {
  const counts = moduleCounts(entry);
  const ops = MODULE_ORDER.filter((m) => counts[m]).map((m) => `${counts[m]} ${MODULE_SHORT[m]}`);
  return [...ops, ...gateLabels(entry)].join(' · ');
}

/** Hover trigger text: '2 ops · ICS', '1 op', 'ICS'. */
export function attachSummary(entry: AddressAttachments): string {
  const n = entry.attachments.filter((a) => a.type === 'operator').length;
  return [...(n ? [`${n} ${n === 1 ? 'op' : 'ops'}`] : []), ...gateLabels(entry)].join(' · ');
}

/** Tooltip text for a role pill, e.g. 'Manager address · owner' */
export function roleHintByLabel(label: RoleLabel, owner: boolean): string {
  if (label === 'P-MGR') return 'Proposed manager address — pending';
  if (label === 'P-RWD') return 'Proposed rewards address — pending';
  if (label === 'CLM') return 'Rewards claimer address';
  const base = label === 'MGR' ? 'Manager address' : 'Rewards address';
  return owner ? `${base} · owner` : base;
}

export function roleHint(entry: RoleEntry): string {
  return roleHintByLabel(entry.label, entry.owner);
}

/** Tooltip text for a type badge, e.g. 'CSM_DEF · curve id 0' — no human-readable expansion exists for the enum. */
export function operatorTypeHint(operatorType: string, curveId: string): string {
  return `${operatorType || 'CC'} · curve id ${curveId}`;
}

export function typeHint(att: Attachment, siteModuleType?: ModuleType): string {
  const base = operatorTypeHint(att.operatorType, att.curveId);
  if (!siteModuleType || att.moduleType === siteModuleType) return base;
  return `${base} — selecting this switches the site to ${MODULE_LABEL[att.moduleType]}`;
}

/** Tooltip text for the count pill, e.g. 'Attached to 2 CSM operators and 1 CM operator — spans both modules.' */
export function countHint(entry: AddressAttachments): string {
  const counts = moduleCounts(entry);
  const parts = MODULE_ORDER.filter((m) => counts[m]).map(
    (m) => `${counts[m]} ${MODULE_LABEL[m]} operator${counts[m] === 1 ? '' : 's'}`,
  );
  const gates = gateLabels(entry);
  const clauses = [
    ...(parts.length ? [`Attached to ${joinList(parts)}`] : []),
    ...(gates.length ? [`${parts.length ? 'unused' : 'Unused'} ${joinList(gates)} proof${gates.length === 1 ? '' : 's'}`] : []),
  ];
  const base = clauses.join(' · ');
  if (entry.modules.length === 2) return `${base} — spans both modules.`;
  if (entry.modules.length > 2) return `${base} — spans ${entry.modules.length} modules.`;
  return `${base}.`;
}

export function gatePillHint(att: GateAttachment): string {
  return att.paused
    ? `${att.gateLabel} gate paused — proof unused, joining blocked`
    : `Unused proof in the ${att.gateLabel} gate tree`;
}
