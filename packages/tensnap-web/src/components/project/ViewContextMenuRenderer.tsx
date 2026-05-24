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
import { exportToCSV } from '@tensnap/core/chart/browser';
import { useUpdateAndDeleteView } from "./view-edit-hooks";
import { copyCanvas } from "@/utils/data";

export const ViewContextMenuRenderer: ViewContextMenuRendererType = (props) => {

  const { view, type, parentView, children, node } = props;

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<AnyView | null>(null);

  const { onViewUpdate } = useViewContext();
  const { deleteView, updateView } = useUpdateAndDeleteView({ parentView, onViewUpdate });

  const charts = useScenarioStore((store) => store.charts);
  const toast = useToast();

  const handleDelete = useCallback((id: string) => {
    deleteView(id);
  }, [deleteView]);

  const handleEdit = useCallback(() => {
    setEditingView(structuredClone(view));
    setIsEditDialogOpen(true);
  }, [view]);

  const handleEditDialogOpenChange = useCallback((open: boolean) => {
    setIsEditDialogOpen(open);
    if (!open) {
      setEditingView(null);
    }
  }, []);

  const handleSaveEdit = useCallback((updatedView: AnyView, objectData?: any) => {
    return updateView(updatedView, objectData);
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
  }, [node, toast]);

  const handleSaveChartAsCSV = useCallback(async () => {
    if (!charts) return;
    const chartGroup = charts.getGroup((view.data as any)?.id);
    if (!chartGroup) {
      toast.error('Chart not found.');
      return;
    }
    exportToCSV(chartGroup);
  }, [charts, view, toast]);

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

      {editingView && (
        <EditViewDialog
          open={isEditDialogOpen}
          onOpenChange={handleEditDialogOpenChange}
          view={editingView}
          onSave={handleSaveEdit}
        />
      )}
    </>
  );

}
