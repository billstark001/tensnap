import { AnyView, ContainerView } from "@/types/ui";


export interface ViewProps<T extends AnyView = AnyView> {
  view: T;
  parentView?: ContainerView;
  updateTrigger?: any; 
}