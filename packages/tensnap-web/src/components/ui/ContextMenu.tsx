import * as RadixContextMenu from '@radix-ui/react-context-menu';
import * as styles from './ContextMenu.css';
import clsx from 'clsx';
import { forwardRef } from 'react';

export interface ContextMenuProps extends RadixContextMenu.ContextMenuProps {
  trigger?: React.ReactNode;
  portalProps?: RadixContextMenu.ContextMenuPortalProps;
  contentProps?: RadixContextMenu.ContextMenuContentProps;
}

export const Root = (props: ContextMenuProps) => {
  const {
    trigger,
    portalProps,
    contentProps,
    children,
    ...rootProps
  } = props;

  return (
    <RadixContextMenu.Root {...rootProps}>
      {trigger ? (
        <RadixContextMenu.Trigger asChild>
          {trigger}
        </RadixContextMenu.Trigger>
      ) : null}
      <RadixContextMenu.Portal {...portalProps}>
        <RadixContextMenu.Content
          {...contentProps}
          className={clsx(
            styles.contextMenu,
            contentProps?.className
          )}
        >
          {children}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
};

export type ItemVariant = 'normal' | 'danger';
const itemVariants = {
  normal: styles.contextMenuItem,
  danger: styles.contextMenuItemDanger,
};

export const Item = forwardRef<HTMLHeadingElement, RadixContextMenu.ContextMenuItemProps & {
  variant?: ItemVariant;
}>((props, ref) => {
  const { variant = 'normal', className, ...rest } = props;
  return (
    <RadixContextMenu.Item
      ref={ref}
      className={clsx(itemVariants[variant], className)}
      {...rest}
    />
  );
});
Item.displayName = 'ContextMenu.Item';

export const Separator = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {
  vertical?: boolean;
}>((props, ref) => {
  return (
    <div {...props} ref={ref} className={clsx(styles.contextMenuSeparator, props.vertical && 'vertical')} />
  );
});
Separator.displayName = 'ContextMenu.Separator';

export const Label = forwardRef<HTMLParagraphElement, RadixContextMenu.ContextMenuLabelProps>((props, ref) => {
  return (
    <RadixContextMenu.Label
      {...props}
      ref={ref}
      className={clsx(styles.contextMenuLabel, props.className)}
    />
  );
});
Label.displayName = 'ContextMenu.Label';

export const Trigger = RadixContextMenu.Trigger;

export default {
  Root,
  Trigger,
  Item,
  Label,
  Separator,
}