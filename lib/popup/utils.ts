import type { FeeSplit } from '../shared/types.js';

const MAX_BP = 10_000;

export function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** bps → '40.00%' */
function formatShare(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Badge hint for the SPL·N marker: one line per recipient, then the operator's keep (floored at 0). */
export function feeSplitsHint(splits: FeeSplit[]): string {
  const n = splits.length;
  const shares = splits.map((s) => Number(s.share));
  const keep = Math.max(0, MAX_BP - shares.reduce((sum, bps) => sum + bps, 0));
  const lines = [
    `Fee splits · ${n} recipient${n === 1 ? '' : 's'}`,
    ...splits.map((s, i) => `${truncateAddress(s.recipient)} · ${formatShare(shares[i]!)}`),
    `Operator keeps ${formatShare(keep)}`,
  ];
  return lines.join('\n');
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
