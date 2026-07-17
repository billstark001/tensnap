import { ConfirmDialog } from '@tensnap/web-common/components/ui/AlertDialog';
import { Trans } from '@lingui/react/macro';
import { useProjectStore } from '@/store/project';

/** App-level policy for closing a dirty project; the generic dialog lives in web-common. */
export function DiscardProjectChangesDialog() {
  const pendingCloseProjectId = useProjectStore((store) => store.pendingCloseProjectId);
  const confirmClose = useProjectStore((store) => store.confirmClose);
  const cancelClose = useProjectStore((store) => store.cancelClose);

  return (
    <ConfirmDialog
      open={pendingCloseProjectId !== null}
      onOpenChange={(open) => {
        if (!open) cancelClose();
      }}
      title={<Trans>Discard unsaved changes?</Trans>}
      description={<Trans>Close this project and discard renderer edits that have not been saved?</Trans>}
      confirmLabel={<Trans>Discard and close</Trans>}
      cancelLabel={<Trans>Keep editing</Trans>}
      confirmVariant="danger"
      onConfirm={confirmClose}
    />
  );
}
