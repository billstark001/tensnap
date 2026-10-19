import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { openMenu, type MenuController } from '../../workbench/menu';
interface MenuContextValue {
  show(x: number, y: number, focus: HTMLElement | null): void;
  close(): void;
  element: HTMLElement | null;
}
export const MenuContext = createContext<MenuContextValue>(null!);
export function Root({ children }: { children: ReactNode }) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const controller = useRef<MenuController | null>(null);
  useEffect(() => () => controller.current?.close(), []);
  return (
    <MenuContext.Provider
      value={{
        element,
        close: () => controller.current?.close(),
        show: (x, y, focus) => {
          controller.current?.close();
          controller.current = openMenu(x, y, focus, () => setElement(null));
          setElement(controller.current.element);
        },
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}
export function Trigger({
  asChild,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const menu = useContext(MenuContext);
  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.defaultPrevented) return;
    if (menu.element) {
      menu.close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    menu.show(rect.left, rect.bottom + 5, event.currentTarget);
  };
  const child =
    asChild && isValidElement(children)
      ? (children as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>)
      : undefined;
  const attributes: ButtonHTMLAttributes<HTMLButtonElement> = {
    ...props,
    onClick: (event) => {
      child?.props.onClick?.(event);
      if (!event.defaultPrevented) props.onClick?.(event);
      toggle(event);
    },
    onKeyDown: (event) => {
      child?.props.onKeyDown?.(event);
      if (!event.defaultPrevented) props.onKeyDown?.(event);
      if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      if (!menu.element) menu.show(rect.left, rect.bottom + 5, event.currentTarget);
    },
    'aria-haspopup': 'menu',
    'aria-expanded': !!menu.element,
  };
  return child ? (
    cloneElement(child, attributes)
  ) : (
    <button type="button" {...attributes}>
      {children}
    </button>
  );
}
/** Actual HTML attributes belong to the rendered menu, rather than a compatibility facade. */
export function Content({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const menu = useContext(MenuContext);
  return menu.element
    ? createPortal(
        <div {...props} role="menu">
          {children}
        </div>,
        menu.element,
      )
    : null;
}
export const Item = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect'> & { onSelect?: (event: Event) => void }
>(({ onSelect, onClick, ...props }, ref) => {
  const menu = useContext(MenuContext);
  return (
    <button
      type="button"
      {...props}
      role="menuitem"
      data-disabled={props.disabled ? '' : undefined}
      tabIndex={-1}
      ref={ref}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
        if (event.defaultPrevented) return;
        const selection = new Event('select', { cancelable: true });
        onSelect?.(selection);
        if (!event.defaultPrevented && !selection.defaultPrevented) menu.close();
      }}
    />
  );
});
export const Separator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div {...props} role="separator" ref={ref} />,
);
export const Label = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div {...props} ref={ref} />
));
