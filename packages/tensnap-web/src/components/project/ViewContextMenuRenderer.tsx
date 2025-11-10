import { Trans } from "@lingui/react/macro";
import ContextMenu from "../ui/ContextMenu";
import { ViewContextMenuRendererType } from "../view/types";
import { Edit, Trash2 } from "lucide-react";
import { EditViewDialog } from "@/dialogs/EditViewDialog";
import { useCallback, useState } from "react";
import { AnyView, ContainerView } from "@/types/ui";
import { findAndDeleteView, findAndUpdateView } from "../view/utils/container";
import { useViewContext } from "../view/useViewContext";



export const ViewContextMenuRenderer: ViewContextMenuRendererType = (props) => {

  const { view, parentView, children } = props;

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
    const { onViewUpdate } = useViewContext();
  
    const handleDelete = useCallback((id: string) => {
      if (!parentView) return;
      findAndDeleteView(parentView, id);
      onViewUpdate?.(parentView.id, parentView);
    }, [parentView, onViewUpdate]);
  
    const handleEdit = useCallback(() => {
      setIsEditDialogOpen(true);
    }, []);
  
    const handleSaveEdit = useCallback((updatedView: AnyView) => {
      const updateRoot = parentView ?? (view.type === 'container' ? view as ContainerView : null);
      if (!updateRoot) {
        return;
      }
      const { id: viewId, type: _, ...rest } = updatedView;
      delete (rest as any).views; 
      findAndUpdateView(updateRoot, viewId, rest);
      onViewUpdate?.(updateRoot.id, updateRoot);
    }, [parentView, onViewUpdate]);
  

  return (
    <>
      <ContextMenu.Root trigger={children} >

        <ContextMenu.Label>
          <Trans>Options</Trans>
        </ContextMenu.Label>

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