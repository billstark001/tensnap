import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import { useState } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import Form from '@tensnap/web-common/components/ui/Form';
import type { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';
import type { Snapshot } from '@tensnap/core/snapshot';

export interface SelectRecordingDialogProps extends DialogOpenProps {
  snapshots?: Snapshot[];
  onSelect?: (id: string) => void;
}
function SelectRecordingDialogContent({
  open,
  onOpenChange,
  snapshots = [],
  onSelect,
}: SelectRecordingDialogProps) {
  const { _ } = useLingui();

  const [selected, setSelected] = useState('');
  const id = snapshots.some((snapshot) => snapshot.metadata.id === selected)
    ? selected
    : snapshots[0]?.metadata.id;
  return (
    <Dialog.Root title={_(msg`Select recording`)} open={open} onOpenChange={onOpenChange}>
      <Dialog.Body>
        <Form.Select
          aria-label="Recording"
          value={id ?? ''}
          onChange={(event) => setSelected(event.target.value)}
        >
          {snapshots.map((snapshot) => (
            <option key={snapshot.metadata.id} value={snapshot.metadata.id}>
              {snapshot.metadata.label ?? snapshot.metadata.id} ({snapshot.frames.length})
            </option>
          ))}
        </Form.Select>
      </Dialog.Body>
      <Dialog.Footer>
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

export const SelectRecordingDialog = defineDialog(
  'SelectRecordingDialog',
  SelectRecordingDialogContent,
  { width: 480, height: 260, minWidth: 320, minHeight: 200 },
);
