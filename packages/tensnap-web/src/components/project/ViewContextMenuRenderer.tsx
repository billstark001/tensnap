import { Trans } from "@lingui/react/macro";
import ContextMenu from '@tensnap/web-common/components/ui/ContextMenu';
import { ViewContextMenuRendererType } from "../view/types";
import { ClipboardCopy, Edit, Pause, Play, Sheet, StepForward, Trash2 } from "lucide-react";
import { EditViewDialog } from "@/dialogs/edit-views/EditViewDialog";
import { useCallback, useState } from "react";
import { AnyView, ButtonView } from "@/types/ui";
import { useViewContext } from "../view/useViewContext";
import { useToast } from "@/store/toast";
import { useScenarioStore } from "@/store/scenario/store";
import { exportToCSV } from '@tensnap/core/chart/browser';
import { useUpdateAndDeleteView } from "./view-edit-hooks";
import { copyCanvas } from "@/utils/data";
import { ContinuousRunDialog } from '@/dialogs/ContinuousRunDialog';
import { useSettingsStore } from '@/store/settings';
import { valueInspectorText } from '@tensnap/core/value-inspector';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

export const ViewContextMenuRenderer: ViewContextMenuRendererType = (props) => {

  const { view, type, parentView, children, node } = props;

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<AnyView | null>(null);
  const [isContinuousRunDialogOpen, setIsContinuousRunDialogOpen] = useState(false);

  const { onViewUpdate, onButtonAction, isRunning } = useViewContext();
  const { deleteView, updateView } = useUpdateAndDeleteView({ parentView, onViewUpdate });

  const charts = useScenarioStore((store) => store.charts);
  const monitors = useScenarioStore((store) => store.scenario.monitors);
  const runProfiles = useSettingsStore((state) => state.continuousRunProfiles);
  const setRunProfile = useSettingsStore((state) => state.setContinuousRunProfile);
  const toast = useToast();
  const { _ } = useLingui();
  const button = type === 'button' ? view as ButtonView : null;
  const continuousActionId = button?.data.continuous ? button.data.id : null;
  const continuousRunIsActive = continuousActionId !== null && isRunning(continuousActionId);

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

  const handleCopyMonitor = useCallback(async () => {
    const monitorId = (view.data as { id?: string } | undefined)?.id;
    const monitor = monitorId ? monitors?.getSnapshot(monitorId) : undefined;
    if (!monitor) {
      toast.error(_(msg`Monitor not found.`));
      return;
    }

    try {
      // Copy the storage snapshot at selection time, rather than the visible
      // page of the inspector, so table/tree display modes produce the same
      // complete text representation.
      await navigator.clipboard.writeText(valueInspectorText(monitor.value ?? null, 1_000_000).text);
      toast.success(_(msg`Monitor data copied to clipboard.`));
    } catch (error) {
      toast.error(
        _(msg`Failed to copy monitor data to clipboard.`),
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [_, monitors, toast, view.data]);

  const handleContinuousRun = useCallback(() => {
    if (!continuousActionId) return;
    if (continuousRunIsActive) {
      onButtonAction(continuousActionId, true);
      return;
    }
    setIsContinuousRunDialogOpen(true);
  }, [continuousActionId, continuousRunIsActive, onButtonAction]);

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

        {type === 'monitor' && (
          <ContextMenu.Item onSelect={handleCopyMonitor}>
            <ClipboardCopy />
            <Trans>Copy</Trans>
          </ContextMenu.Item>
        )}

        {continuousActionId && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item onSelect={handleContinuousRun}>
              {continuousRunIsActive ? <Pause /> : <Play />}
              {continuousRunIsActive ? <Trans>Stop continuous run</Trans> : <Trans>Continuous run…</Trans>}
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => onButtonAction(continuousActionId, false)}>
              <StepForward />
              <Trans>Run one step</Trans>
            </ContextMenu.Item>
          </>
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
      {continuousActionId && (
        <ContinuousRunDialog
          key={`${continuousActionId}:${isContinuousRunDialogOpen}:${JSON.stringify(runProfiles[continuousActionId])}`}
          open={isContinuousRunDialogOpen}
          actionId={continuousActionId}
          profile={runProfiles[continuousActionId]}
          onOpenChange={setIsContinuousRunDialogOpen}
          onRun={(profile) => {
            setRunProfile(continuousActionId, profile);
            onButtonAction(continuousActionId, true, {
              maxSteps: profile.maxSteps,
              stopWhen: profile.stopWhen,
              maxWallTimeMs: profile.maxWallTimeMs,
              record: profile.record ? {} : false,
            });
          }}
        />
      )}
    </>
  );

}
