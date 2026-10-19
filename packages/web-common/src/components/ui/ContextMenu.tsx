import {
  cloneElement,
  forwardRef,
  useContext,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
} from 'react';
import * as Menu from './DropdownMenu';
import * as styles from './ContextMenu.css';
import clsx from 'clsx';
export interface ContextMenuProps {
  trigger?: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}
function ContextTrigger({ trigger, disabled }: { trigger?: ReactNode; disabled?: boolean }) {
  const menu = useContext(Menu.MenuContext);
  if (!trigger) return null;
  const child = trigger as ReactElement<HTMLAttributes<HTMLElement>>;
  return cloneElement(child, {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      child.props.onContextMenu?.(event);
      if (disabled || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      menu.show(event.clientX, event.clientY, event.currentTarget);
    },
  });
}
export function Root({ trigger, disabled, children }: ContextMenuProps) {
  return (
    <Menu.Root>
      <ContextTrigger trigger={trigger} disabled={disabled} />
      <Menu.Content className={styles.contextMenu}>{children}</Menu.Content>
    </Menu.Root>
  );
}
export type ItemVariant = 'normal' | 'danger';
export const Item = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Menu.Item> & { variant?: ItemVariant }
>(({ variant, className, ...props }, ref) => (
  <Menu.Item
    {...props}
    ref={ref}
    className={clsx(
      variant === 'danger' ? styles.contextMenuItemDanger : styles.contextMenuItem,
      className,
    )}
  />
));
export const Label = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <Menu.Label {...props} ref={ref} className={clsx(styles.contextMenuLabel, props.className)} />
));
export const Separator = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { vertical?: boolean }
>(({ vertical, ...props }, ref) => (
  <Menu.Separator
    {...props}
    ref={ref}
    className={clsx(styles.contextMenuSeparator, vertical && 'vertical', props.className)}
  />
));
export default { Root, Item, Label, Separator };
