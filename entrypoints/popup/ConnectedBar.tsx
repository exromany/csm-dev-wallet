import React from 'react';
import type { AddressRole, ModuleType, SelectedAddress } from '../../lib/shared/types.js';
import type { AddressAttachments } from '../../lib/shared/attachments.js';
import { ANVIL_CHAIN_ID } from '../../lib/shared/networks.js';
import { truncateAddress } from '../../lib/popup/utils.js';
import { useCopyAddress } from '../../lib/popup/hooks.js';
import { LabelEditor } from './LabelEditor.js';
import { AttachedOperators } from './AttachedOperators.js';
import { IconCheck, IconClose, IconCopy, IconEye, IconKey } from './icons.js';

type Props = {
  address: SelectedAddress;
  chainId: number;
  label?: string;
  onSetLabel: (label: string) => void;
  onDisconnect: () => void;
  attachments?: AddressAttachments;
  attachmentsLoading?: boolean;
  siteModuleType?: ModuleType;
  operatorLabel?: (operatorId: string, moduleType: ModuleType) => string;
  onSelectAttachment?: (operatorId: string, role: AddressRole, moduleType: ModuleType) => void;
};

export function ConnectedBar({
  address,
  chainId,
  label,
  onSetLabel,
  onDisconnect,
  attachments,
  attachmentsLoading = false,
  siteModuleType,
  operatorLabel,
  onSelectAttachment,
}: Props) {
  const isAnvil = chainId === ANVIL_CHAIN_ID;
  const { copy, isCopied } = useCopyAddress();
  const copied = isCopied(address.address);

  return (
    <div className="connected-pill">
      <span className="dot" />
      <span className="address mono">{truncateAddress(address.address)}</span>
      <LabelEditor
        label={label ?? ''}
        onSave={onSetLabel}
        className="pill-label"
        placeholder="Name this address…"
      />
      <div className="spacer" />
      <span
        className={`mode hint hint-right ${isAnvil ? 'anvil' : 'watch'}`}
        data-hint={
          isAnvil
            ? 'Anvil fork — transactions are signed by impersonating this account'
            : 'Watch-only — signing requests from the dapp are rejected'
        }
      >
        {isAnvil ? <IconKey /> : <IconEye />}
        {isAnvil ? 'anvil' : 'watch'}
      </span>
      {siteModuleType && operatorLabel && onSelectAttachment && (
        <AttachedOperators
          entry={attachments}
          loading={attachmentsLoading}
          siteModuleType={siteModuleType}
          operatorLabel={operatorLabel}
          onSelect={onSelectAttachment}
        />
      )}
      <button
        className={`pill-act hint hint-right ${copied ? 'copied' : ''}`}
        onClick={() => copy(address.address)}
        data-hint={copied ? 'Copied' : 'Copy address'}
      >
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
      <button className="pill-act danger hint hint-right" data-hint="Disconnect" onClick={onDisconnect}>
        <IconClose />
      </button>
    </div>
  );
}
