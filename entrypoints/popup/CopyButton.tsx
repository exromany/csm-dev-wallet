import React from 'react';
import { useCopyAddress } from '../../lib/popup/hooks.js';
import { IconCheck, IconCopy } from './icons.js';

export function CopyButton({ address, className = '' }: { address: string; className?: string }) {
  const { copy, isCopied } = useCopyAddress();
  const copied = isCopied(address);
  return (
    <button
      className={`btn-copy hint hint-right ${copied ? 'copied' : ''} ${className}`.trimEnd()}
      onClick={(e) => { e.stopPropagation(); copy(address); }}
      data-hint={copied ? 'Copied' : 'Copy address'}
      aria-label={copied ? 'Copied' : 'Copy address'}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}
