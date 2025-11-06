import { AnyView, ContainerView } from "@/types/ui";


export interface ViewProps<T extends AnyView = AnyView> {
  view: T;
  parentView?: ContainerView;
  updateTrigger?: any; 
  onViewUpdate?: (id: string, view: AnyView) => void;
}