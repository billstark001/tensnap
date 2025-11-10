import { Trans } from "@lingui/react/macro";
import ContextMenu from "../ui/ContextMenu";
import { ViewContextMenuRendererType } from "../view/types";
import { ClipboardCopy, Edit, Sheet, Trash2 } from "lucide-react";
import { EditViewDialog } from "@/dialogs/EditViewDialog";
import { useCallback, useState } from "react";
import { AnyView, ContainerView } from "@/types/ui";
import { findAndDeleteView, findAndUpdateView } from "../view/utils/container";
import { useViewContext } from "../view/useViewContext";
import { useToast } from "@/store/toast";
import { useScenarioStore } from "@/store/scenario/store";
import { exportToCSV } from "@/store/scenario/chart";



const copyCanvas = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    });
  });
  if (blob) {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  }
  return false;
};

const copySVG = async (svgElement: SVGSVGElement) => {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const clipboardItem = new ClipboardItem({ 'image/svg+xml': blob });
  await navigator.clipboard.write([clipboardItem]);
  return true;
};

const copySvgAsBitmap = async (svgElement: SVGSVGElement) => {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgElement);

  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = svgElement.viewBox.baseVal.width || svgElement.width.baseVal.value || 200;
  canvas.height = svgElement.viewBox.baseVal.height || svgElement.height.baseVal.value || 200;
  const ctx = canvas.getContext("2d");
  ctx!.drawImage(img, 0, 0);

  URL.revokeObjectURL(url);

  return await copyCanvas(canvas);
};


export const ViewContextMenuRenderer: ViewContextMenuRendererType = (props) => {

  const { view, type, dataType, parentView, children, node } = props;

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const { onViewUpdate } = useViewContext();

  const charts = useScenarioStore((store) => store.charts);

  const toast = useToast();

  const handleDelete = useCallback((id: string) => {
    if (!parentView) return;
    findAndDeleteView(parentView, id);
    onViewUpdate?.(parentView.id, parentView);
  }, [parentView, onViewUpdate]);

  const handleEdit = useCallback(() => {
    setIsEditDialogOpen(true);
  }, []);

  const updateParameter = useScenarioStore((store) => store.updateParameterProps);
  const updateEnvironment = useScenarioStore((store) => store.updateEnvironment);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);

  const handleSaveEdit = useCallback((updatedView: AnyView, objectData?: any) => {
    const updateRoot = parentView ?? (view.type === 'container' ? view as ContainerView : null);
    if (!updateRoot) {
      return;
    }
    const { id: viewId, type: _, ...rest } = updatedView;
    delete (rest as any).views;
    findAndUpdateView(updateRoot, viewId, rest);
    onViewUpdate?.(updateRoot.id, updateRoot);

    // Update the associated object data if provided
    if (objectData) {
      if (updatedView.type === 'parameter') {
        const { id, ...props } = objectData;
        updateParameter?.(id, props);
      } else if (updatedView.type === 'environment') {
        const { id, props: envProps } = objectData;
        updateEnvironment?.(id, envProps);
      } else if (updatedView.type === 'chart') {
        const { id, ...props } = objectData;
        updateChartProps?.(id, props);
      }
    }
  }, [parentView, onViewUpdate, updateParameter, updateEnvironment, updateChartProps]);

  const handleCopySVG = useCallback(async () => {
    if (!node) return;
    const svgElement = node.querySelector('svg');
    if (svgElement) {
      try {
        if (await copySVG(svgElement)) {
          toast.success('SVG copied to clipboard!');
        } else {
          toast.error('Failed to copy SVG to clipboard.');
        }
      } catch (error) {
        toast.error('Failed to copy SVG to clipboard.', String(error));
      }
    }
  }, [node, toast.success, toast.error]);


  const handleCopySVGAsBitmap = useCallback(async () => {
    if (!node) return;
    const svgElement = node.querySelector('svg');
    if (svgElement) {
      try {
        if (await copySvgAsBitmap(svgElement)) {
          toast.success('SVG copied to clipboard!');
        } else {
          toast.error('Failed to copy SVG to clipboard.');
        }
      } catch (error) {
        toast.error('Failed to copy SVG to clipboard.', String(error));
      }
    }
  }, [node, toast.success, toast.error]);

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
    const chartGroup = charts.allChartGroups.get((view.data as any)?.id);
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

        {(type === 'chart' || (type === 'environment' && dataType !== 'graph')) && (
          <ContextMenu.Item onSelect={handleCopyCanvas}>
            <ClipboardCopy />
            <Trans>Copy</Trans>
          </ContextMenu.Item>
        )}

        {(type === 'environment' && dataType === 'graph') && (<>
          <ContextMenu.Item onSelect={handleCopySVG}>
            <ClipboardCopy />
            <Trans>Copy</Trans>
          </ContextMenu.Item>
          <ContextMenu.Item onSelect={handleCopySVGAsBitmap}>
            <ClipboardCopy />
            <Trans>Copy As Bitmap</Trans>
          </ContextMenu.Item>
        </>)}

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