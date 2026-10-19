import { registerWindowType, type WindowDimensions } from './window-state';
import {
  createContext,
  createElement,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from 'react';

export interface NativeDialogHandle {
  update(props: object): void;
  dispose(): void;
}
export interface NativeDialogRuntime {
  supports(contentId: string): boolean;
  open(
    contentId: string,
    props: object,
    close: () => void,
    projectId: string | null,
  ): NativeDialogHandle;
}
export const WindowTypeContext = createContext('Dialog');
/** In-process ownership only: retain actual providers, never copied stores or services. */
export interface DialogScope {
  id: string | null;
  render(content: ReactNode, onClose: () => void): ReactNode;
}
export const DialogScopeContext = createContext<DialogScope>({
  id: null,
  render: (content) => content,
});

let nativeRuntime: NativeDialogRuntime | undefined;
export function configureNativeDialogRuntime(runtime: NativeDialogRuntime): void {
  nativeRuntime = runtime;
}
export function defineDialog<P extends object>(
  id: string,
  component: ComponentType<P>,
  dimensions?: WindowDimensions,
): ComponentType<P> {
  registerWindowType(id, dimensions);
  const content = (props: P) =>
    createElement(WindowTypeContext.Provider, { value: id }, createElement(component, props));
  return function DialogContent(props: P) {
    const scope = useContext(DialogScopeContext);
    const native = nativeRuntime?.supports(id) ? nativeRuntime : undefined;
    const handle = useRef<NativeDialogHandle | null>(null);
    const values = props as {
      open?: boolean;
      agent?: unknown;
      onOpenChange?: (open: boolean) => void;
      onClose?: () => void;
    };
    const open = values.open ?? Boolean(values.agent);
    const owned = useRef<{ scope: DialogScope; props: P } | undefined>(undefined);
    if (!open) owned.current = undefined;
    else if (!owned.current) owned.current = { scope, props };
    else if (owned.current.scope.id === scope.id) owned.current.props = props;
    useLayoutEffect(() => {
      if (!native || !open) return;
      handle.current = native.open(
        id,
        owned.current?.props ?? props,
        () => {
          const current = owned.current?.props as typeof values | undefined;
          if (current?.onOpenChange) current.onOpenChange(false);
          else current?.onClose?.();
        },
        owned.current?.scope.id ?? null,
      );
      return () => {
        handle.current?.dispose();
        handle.current = null;
      };
    }, [open]);
    useLayoutEffect(() => {
      if (owned.current?.scope.id === scope.id) handle.current?.update(props);
    });
    return native
      ? null
      : owned.current
        ? owned.current.scope.render(createElement(content, owned.current.props), () => {
            const callbacks = owned.current?.props as typeof values | undefined;
            if (callbacks?.onOpenChange) callbacks.onOpenChange(false);
            else callbacks?.onClose?.();
          })
        : null;
  };
}
