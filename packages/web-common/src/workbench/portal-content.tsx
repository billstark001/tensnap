import { useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { mountContent, type ContentDefinition } from './content';

function portalDefinition() {
  let view: { host: HTMLElement; context: ReactNode } | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: typeof view) => {
    view = next;
    listeners.forEach((changed) => changed());
  };
  const definition: ContentDefinition<ReactNode> = {
    mount(host, context) {
      publish({ host, context });
      return {
        update(next) {
          if (view?.context !== next) publish({ host, context: next });
        },
        dispose() {
          publish(null);
        },
      };
    },
  };
  let mounted: ReturnType<typeof mountContent<ReactNode>> | undefined;
  return {
    mount(host: HTMLElement, context: ReactNode, visible: boolean) {
      mounted = mountContent(definition, host, context, visible);
      return () => {
        mounted?.dispose();
        mounted = undefined;
      };
    },
    update(context: ReactNode) {
      mounted?.update(context);
    },
    setVisible(visible: boolean) {
      mounted?.setVisible(visible);
    },
    snapshot: () => view,
    subscribe: (changed: () => void) => {
      listeners.add(changed);
      return () => {
        listeners.delete(changed);
      };
    },
  };
}

/** React binding for the same content lifecycle, preserving the caller's Context through a portal. */
export function ContentIsland({
  host,
  visible = true,
  children,
}: {
  host: HTMLElement;
  visible?: boolean;
  children: ReactNode;
}) {
  const [content] = useState(portalDefinition);
  const view = useSyncExternalStore(content.subscribe, content.snapshot);
  useLayoutEffect(() => {
    return content.mount(host, children, visible);
  }, [host, content]);
  useLayoutEffect(() => {
    content.update(children);
  }, [content, children]);
  useLayoutEffect(() => {
    content.setVisible(visible);
  }, [content, visible]);
  return view ? createPortal(view.context, view.host) : null;
}
