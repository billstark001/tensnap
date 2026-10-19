/** A host owns geometry and visibility; content owns its business UI. */
export interface MountedContent<T> {
  update(context: T): void;
  resize?(width: number, height: number): void;
  visibility?(visible: boolean): void;
  dispose(): void;
}
export interface ContentDefinition<T> {
  mount(host: HTMLElement, context: T): MountedContent<T>;
}
export interface WindowOptions {
  title: string;
  type: string;
  size: 'md' | 'lg' | 'xl' | 'full';
  modal: boolean;
  dismissible: boolean;
  onClose(): void;
}
export interface ContentWindow {
  element: HTMLElement;
  update(options: WindowOptions): void;
  dispose(): void;
}
export interface DialogHost {
  create(options: WindowOptions): ContentWindow;
}
let dialogHost: DialogHost | undefined;
export function configureDialogHost(host: DialogHost): void {
  dialogHost = host;
}
export function getDialogHost(): DialogHost {
  if (!dialogHost)
    throw new Error('The application must configure its dialog host before mounting content.');
  return dialogHost;
}

/** Attach content to a stable host and own its geometry/visibility notifications. */
export function mountContent<T>(
  definition: ContentDefinition<T>,
  host: HTMLElement,
  context: T,
  visible = true,
) {
  const content = definition.mount(host, context);
  content.visibility?.(visible);
  const resize = new ResizeObserver(([entry]) =>
    content.resize?.(entry.contentRect.width, entry.contentRect.height),
  );
  resize.observe(host);
  let disposed = false;
  return {
    update(next: T) {
      if (!disposed) content.update(next);
    },
    setVisible(next: boolean) {
      if (!disposed) content.visibility?.(next);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resize.disconnect();
      content.dispose();
    },
  };
}
