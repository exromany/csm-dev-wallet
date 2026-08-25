import type { Address } from 'viem';
import type { AddressRole, CachedOperator, ModuleType } from './types.js';

export type RoleLabel = 'MGR' | 'RWD' | 'P-MGR' | 'P-RWD';

export type RoleEntry = {
  role: AddressRole;
  label: RoleLabel;
  tint: 'mgr' | 'rwd';
  address: Address;
  proposed: boolean;
  owner: boolean;
};

/**
 * The (role, address) slots an operator holds — unset proposed roles omitted.
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
  return entries;
}

/** 'CSM_LEA' → 'csm-lea' — drives per-type ribbon colour via CSS class. */
export function operatorKind(operatorType: string): string {
  return (operatorType || 'cc').toLowerCase().replace(/_/g, '-');
}

/** One operator an address is attached to, with every role it holds there. */
export type Attachment = {
  moduleType: ModuleType;
  operatorId: string;
  operatorType: string; // raw, e.g. 'CSM_DEF' or the 'CC' fallback
  curveId: string; // BigInt kept as string end to end — chrome.storage can't hold BigInts
  typeLabel: string;    // 'CSM·DEF' — module prefix restored for cross-module display
  kind: string;         // 'csm-def' — ribbon colour class suffix
  primaryRole: AddressRole; // role to attribute a selection to
  pills: RoleEntry[];
};

export type AddressAttachments = {
  address: Address;
  attachments: Attachment[];
  modules: ModuleType[];
  crossModule: boolean;
  pending: boolean; // holds at least one proposed role
};

const MODULE_ORDER: ModuleType[] = ['csm', 'cm'];

/** 'CSM_DEF' → 'CSM·DEF'. The prefixless 'CC' fallback takes its cache module. */
export function attachmentTypeLabel(moduleType: ModuleType, operatorType: string): string {
  const bare = (operatorType || 'CC').replace(/^CSM_|^CM_/, '');
  return `${moduleType.toUpperCase()}·${bare}`;
}

/**
 * Reverse index over one or both module caches: lowercased address → attachments.
 * Roles of the same address on the same operator collapse into one attachment;
 * the same operator id in different modules stays two.
 */
export function buildAttachmentIndex(
  byModule: Partial<Record<ModuleType, CachedOperator[]>>,
): Map<string, AddressAttachments> {
  const index = new Map<string, AddressAttachments>();

  for (const moduleType of MODULE_ORDER) {
    for (const op of byModule[moduleType] ?? []) {
      const perAddress = new Map<string, Attachment>();
      for (const e of roleEntries(op)) {
        const key = e.address.toLowerCase();
        let att = perAddress.get(key);
        if (!att) {
          att = {
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

      for (const [key, att] of perAddress) {
        let entry = index.get(key);
        if (!entry) {
          entry = {
            address: att.pills[0].address,
            attachments: [],
            modules: [],
            crossModule: false,
            pending: false,
          };
          index.set(key, entry);
        }
        entry.attachments.push(att);
      }
    }
  }

  for (const entry of index.values()) {
    entry.modules = MODULE_ORDER.filter((m) => entry.attachments.some((a) => a.moduleType === m));
    entry.crossModule = entry.modules.length > 1;
    entry.pending = entry.attachments.some((a) => a.pills.some((p) => p.proposed));
  }

  return index;
}

/** Addresses held by more than one operator — most attachments first. */
export function sharedAddresses(index: Map<string, AddressAttachments>): AddressAttachments[] {
  return [...index.values()]
    .filter((e) => e.attachments.length > 1)
    .sort(
      (a, b) =>
        b.attachments.length - a.attachments.length ||
        a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
    );
}

export function moduleCounts(entry: AddressAttachments): { csm: number; cm: number } {
  let csm = 0;
  for (const a of entry.attachments) if (a.moduleType === 'csm') csm++;
  return { csm, cm: entry.attachments.length - csm };
}

/** '2 CSM · 1 CM' when the address spans modules, '2 CM' when it does not. */
export function countLabel(entry: AddressAttachments): string {
  const { csm, cm } = moduleCounts(entry);
  if (csm && cm) return `${csm} CSM · ${cm} CM`;
  return csm ? `${csm} CSM` : `${cm} CM`;
}

/** Tooltip text for a role pill, e.g. 'Manager address · owner' */
export function roleHintByLabel(label: RoleLabel, owner: boolean): string {
  if (label === 'P-MGR') return 'Proposed manager address — pending';
  if (label === 'P-RWD') return 'Proposed rewards address — pending';
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
  return `${base} — selecting this switches the site to ${att.moduleType.toUpperCase()}`;
}

/** Tooltip text for the count pill, e.g. 'Attached to 2 CSM operators and 1 CM operator — spans both modules.' */
export function countHint(entry: AddressAttachments): string {
  const { csm, cm } = moduleCounts(entry);
  const parts: string[] = [];
  if (csm) parts.push(`${csm} CSM operator${csm === 1 ? '' : 's'}`);
  if (cm) parts.push(`${cm} CM operator${cm === 1 ? '' : 's'}`);
  const sentence = `Attached to ${parts.join(' and ')}.`;
  return entry.crossModule ? `${sentence.slice(0, -1)} — spans both modules.` : sentence;
}
