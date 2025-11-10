import { AnchoredView, AnyView, ContainerView } from "@/types/ui";
import { ComponentType, PropsWithChildren } from "react";


export interface ViewProps<T extends AnyView = AnyView> {
  view: T;
  parentView?: ContainerView;
  updateTrigger?: any;
}

export const getViewType = (view: AnyView): { type: AnyView['type']; dataType: string | null } => {
  view ??= {} as AnyView;
  const type = view.type || 'parameter';
  const dataType = (view as AnchoredView).data?.type || null;
  return { type, dataType };
};

export type AnchoredViewRendererType = ComponentType<{
  view: AnyView,
  parentView?: ContainerView,
  id: string,
  type: AnchoredView['type'],
}>;

export type ViewContextMenuRendererType = ComponentType<PropsWithChildren<{
  view: AnyView,
  parentView?: ContainerView,
  type: AnyView['type'],
  dataType: string | null,
}>>;