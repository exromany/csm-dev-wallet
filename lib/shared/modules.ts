import type { ModuleType } from './types.js';

/** Every module, in display order. */
export const MODULE_ORDER: ModuleType[] = ['csm', 'csm02', 'cm'];

/** CSM is deployed on every supported chain and is the fallback the popup
 *  switches to, so it is assumed available rather than RPC-probed — a
 *  transient RPC failure must never leave nothing selectable. */
export const BASELINE_MODULE: ModuleType = 'csm';

export const PROBED_MODULES: ModuleType[] = MODULE_ORDER.filter((m) => m !== BASELINE_MODULE);

/** Prose name — picker chips, scope notes, tooltips. */
export const MODULE_LABEL: Record<ModuleType, string> = {
  csm: 'CSM', csm02: 'CSM 0x02', cm: 'CM',
};

/** Compact name for badges and count pills, where a space would wrap. */
export const MODULE_SHORT: Record<ModuleType, string> = {
  csm: 'CSM', csm02: 'CSM02', cm: 'CM',
};
