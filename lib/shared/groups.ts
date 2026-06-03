import type { CachedOperator } from './types.js';

/**
 * A group derived from cached CM operators. CSM operators never appear here.
 *
 * `id` is the on-chain MetaRegistry group id, serialized as a string
 * (matches CachedOperator.groupId).
 */
export type OperatorGroup = {
  id: string;
  name?: string; // optional on-chain title
  operators: CachedOperator[];
};

export type GroupedOperators = {
  groups: OperatorGroup[];
  ungrouped: CachedOperator[];
};

/** Bucket operators by groupId, preserving the input order within each group. */
export function groupOperators(operators: CachedOperator[]): GroupedOperators {
  const groupsById = new Map<string, OperatorGroup>();
  const ungrouped: CachedOperator[] = [];

  for (const op of operators) {
    if (!op.groupId) {
      ungrouped.push(op);
      continue;
    }
    let group = groupsById.get(op.groupId);
    if (!group) {
      group = { id: op.groupId, name: op.groupName, operators: [] };
      groupsById.set(op.groupId, group);
    }
    // First non-empty name wins (operators in a group should agree, but be defensive)
    if (!group.name && op.groupName) group.name = op.groupName;
    group.operators.push(op);
  }

  // Sort groups by numeric id ascending (string ids serialized from bigint).
  const groups = [...groupsById.values()].sort((a, b) => {
    const ai = BigInt(a.id);
    const bi = BigInt(b.id);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  return { groups, ungrouped };
}

/** Display label for a group — on-chain title or "Group #<id>" fallback. */
export function groupLabel(group: OperatorGroup): string {
  return group.name && group.name.length > 0 ? group.name : `Group #${group.id}`;
}
