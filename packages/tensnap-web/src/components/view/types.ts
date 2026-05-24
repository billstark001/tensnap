import { AnchoredView, AnyView, ContainerView } from "@/types/ui";
import { ComponentType, PropsWithChildren } from "react";

/**
 * Point type for positioning
 */
export type Point = {
  x: number;
  y: number;
};

/**
 * Metadata for environment objects used in view creation
 */
export type ObjectWithEnvironmentMetadata = {
  id: string;
  type: '2d' | 'uniform';
  label?: string;
  width?: number;
  height?: number;
};

/**
 * Metadata for chart objects used in view creation
 */
export type ObjectWithChartMetadata = {
  id: string;
  label: string;
};

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
  node?: HTMLElement | null,
  view: AnyView,
  parentView?: ContainerView,
  type: AnyView['type'],
  dataType: string | null,
}>>;


export type DraggableViewData = {
  view?: AnyView;
  siblings?: AnyView[];
  relativeLeft: number;
  relativeTop: number;
  parentView?: ContainerView;
  parentId?: string;
};

export type DroppableViewData = {
  view?: ContainerView;
  containerId?: string;
  relativeLeft: number;
  relativeTop: number;
}