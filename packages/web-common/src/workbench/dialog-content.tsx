import { registerWindowType, type WindowDimensions } from './window-state';
import { createContext, createElement, useLayoutEffect, useRef, type ComponentType } from 'react';
import type { ContentDefinition } from './content';

export interface NativeDialogHandle {
  update(props: object): void;
  dispose(): void;
}
export interface NativeDialogRuntime {
  open(contentId: string, props: object, close: () => void): NativeDialogHandle;
}
export const WindowTypeContext = createContext('Dialog');

let nativeRuntime: NativeDialogRuntime | undefined;
const definitions = new Map<string, ComponentType<any>>();
export function configureNativeDialogRuntime(runtime: NativeDialogRuntime): void {
  nativeRuntime = runtime;
}
export function dialogContent(id: string): ComponentType<any> {
  const component = definitions.get(id);
  if (!component) throw new Error(`Unknown dialog content: ${id}`);
  return component;
}
/** Render through the caller-owned root; content lifecycle never creates a React root. */
export function reactContent<T>(
  component: ComponentType<T>,
  wrap: (content: React.ReactNode) => React.ReactNode,
  render: (content: React.ReactNode) => void,
): ContentDefinition<T> {
  return {
    mount(_host, context) {
      const update = (props: T) =>
        render(wrap(createElement(component as ComponentType<any>, props)));
      update(context);
      return { update, dispose: () => render(null) };
    },
  };
}

export function defineDialog<P extends object>(
  id: string,
  component: ComponentType<P>,
  dimensions?: WindowDimensions,
): ComponentType<P> {
  registerWindowType(id, dimensions);
  // A stable content ID names its current module definition, including hot module updates.
  const content = (props: P) =>
    createElement(WindowTypeContext.Provider, { value: id }, createElement(component, props));
  definitions.set(id, content);
  return function DialogContent(props: P) {
    const handle = useRef<NativeDialogHandle | null>(null);
    const latest = useRef(props);
    useLayoutEffect(() => {
      latest.current = props;
    });
    const values = props as {
      open?: boolean;
      agent?: unknown;
      onOpenChange?: (open: boolean) => void;
      onClose?: () => void;
    };
    const open = values.open ?? Boolean(values.agent);
    useLayoutEffect(() => {
      if (!nativeRuntime || !open) return;
      handle.current = nativeRuntime.open(id, latest.current, () => {
        const current = latest.current as typeof values;
        if (current.onOpenChange) current.onOpenChange(false);
        else current.onClose?.();
      });
      return () => {
        handle.current?.dispose();
        handle.current = null;
      };
    }, [open]);
    useLayoutEffect(() => {
      handle.current?.update(props);
    });
    return nativeRuntime ? null : createElement(content, props);
  };
}
