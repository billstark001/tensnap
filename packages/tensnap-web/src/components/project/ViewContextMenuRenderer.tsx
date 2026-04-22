import { Trans } from "@lingui/react/macro";
import ContextMenu from '@tensnap/web-common/components/ui/ContextMenu';
import { ViewContextMenuRendererType } from "../view/types";
import { ClipboardCopy, Edit, Sheet, Trash2 } from "lucide-react";
import { EditViewDialog } from "@/dialogs/edit-views/EditViewDialog";
import { useCallback, useState } from "react";
import { AnyView } from "@/types/ui";
import { useViewContext } from "../view/useViewContext";
import { useToast } from "@/store/toast";
import { useScenarioStore } from "@/store/scenario/store";
import { exportToCSV } from '@tensnap/core';
import { useUpdateAndDeleteView } from "./view-edit-hooks";
import { copyCanvas } from "@/utils/data";

export const ViewContextMenuRenderer: ViewContextMenuRendererType = (props) => {

  const { view, type, parentView, children, node } = props;

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const { onViewUpdate } = useViewContext();
  const { deleteView, updateView } = useUpdateAndDeleteView({ parentView, onViewUpdate });

  const charts = useScenarioStore((store) => store.charts);
  const toast = useToast();

  const handleDelete = useCallback((id: string) => {
    deleteView(id);
  }, [deleteView]);

  const handleEdit = useCallback(() => {
    setIsEditDialogOpen(true);
  }, []);

  const handleSaveEdit = useCallback((updatedView: AnyView, objectData?: any) => {
    updateView(updatedView, objectData);
  }, [updateView]);

  const handleCopyCanvas = useCallback(async () => {
    if (!node) return;
    const canvasElement = node.querySelector('canvas');
    if (canvasElement) {
      try {
        if (await copyCanvas(canvasElement)) {
          toast.success('Canvas copied to clipboard!');
        } else {
          toast.error('Failed to copy canvas to clipboard.');
        }
      } catch (error) {
        toast.error('Failed to copy canvas to clipboard.', String(error));
      }
    }
  }, [node, toast.success, toast.error]);

  const handleSaveChartAsCSV = useCallback(async () => {
    if (!charts) return;
    const chartGroup = charts.getGroup((view.data as any)?.id);
    if (!chartGroup) {
      toast.error('Chart not found.');
      return;
    }
    exportToCSV(chartGroup);
  }, [charts, view, toast.error]);

  return (
    <>
      <ContextMenu.Root trigger={children} >

        <ContextMenu.Label>
          <Trans>Options</Trans>
        </ContextMenu.Label>

        {type === 'chart' && (
          <ContextMenu.Item onSelect={handleSaveChartAsCSV}>
            <Sheet />
            <Trans>Save As CSV</Trans>
          </ContextMenu.Item>
        )}

        {(type === 'chart' || type === 'environment') && (
          <ContextMenu.Item onSelect={handleCopyCanvas}>
            <ClipboardCopy />
            <Trans>Copy</Trans>
          </ContextMenu.Item>
        )}

        <ContextMenu.Separator />

        <ContextMenu.Item
          onSelect={handleEdit}
        >
          <Edit />
          <Trans>Edit</Trans>
        </ContextMenu.Item>

        <ContextMenu.Item
          variant='danger'
          onSelect={() => handleDelete(view.id)}
        >
          <Trash2 />
          <Trans>Delete</Trans>
        </ContextMenu.Item>
      </ContextMenu.Root>

      <EditViewDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        view={view}
        onSave={handleSaveEdit}
      />
    </>
  );

}