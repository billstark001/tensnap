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
  decorate(className: string, style?: React.CSSProperties): void;
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
        decorate: (className, style) =>
          controller.current?.decorate(className, style as Partial<CSSStyleDeclaration>),
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
  const onClick: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] = (event) => {
    if (menu.element) {
      menu.close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    menu.show(rect.left, rect.bottom + 5, event.currentTarget);
  };
  const attributes = {
    ...props,
    onClick,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': !!menu.element,
  };
  if (asChild && isValidElement(children))
    return cloneElement(
      children as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>,
      attributes,
    );
  return (
    <button type="button" {...attributes}>
      {children}
    </button>
  );
}
export function Content({
  sideOffset: _sideOffset,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { sideOffset?: number }) {
  const menu = useContext(MenuContext);
  useEffect(() => {
    menu.decorate(props.className ?? '', props.style);
  }, [menu.element, props.className, props.style]);
  return menu.element ? createPortal(children, menu.element) : null;
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
        onClick?.(event);
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
