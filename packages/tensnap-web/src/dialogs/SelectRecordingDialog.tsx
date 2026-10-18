import { useState } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import type { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';
import type { Snapshot } from '@tensnap/core/snapshot';

export interface SelectRecordingDialogProps extends DialogOpenProps {
  snapshots?: Snapshot[];
  onSelect?: (id: string) => void;
}
export function SelectRecordingDialog({
  open,
  onOpenChange,
  snapshots = [],
  onSelect,
}: SelectRecordingDialogProps) {
  const [selected, setSelected] = useState('');
  const id = snapshots.some((snapshot) => snapshot.metadata.id === selected)
    ? selected
    : snapshots[0]?.metadata.id;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Title>
        <Trans>Select recording</Trans>
      </Dialog.Title>
      <Dialog.Body>
        <select
          aria-label="Recording"
          value={id ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          {snapshots.map((snapshot) => (
            <option key={snapshot.metadata.id} value={snapshot.metadata.id}>
              {snapshot.metadata.label ?? snapshot.metadata.id} ({snapshot.frames.length})
            </option>
          ))}
        </select>
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button>
            <Trans>Cancel</Trans>
          </Dialog.Button>
        </Dialog.Close>
        <Dialog.Button
          disabled={!id}
          onClick={() => {
            if (id) {
              onSelect?.(id);
              onOpenChange?.(false);
            }
          }}
        >
          <Trans>Open recording</Trans>
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}
