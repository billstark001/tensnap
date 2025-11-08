import * as RadixDialog from '@radix-ui/react-dialog';
import * as dialogStyles from './Dialog.css';
import clsx from 'clsx';
import { X } from 'lucide-react';

export interface DialogProps extends RadixDialog.DialogProps {
  closeOnInteractOutside?: boolean;
  size?: 'md' | 'lg' | 'xl';
  portalProps?: RadixDialog.DialogPortalProps;
  overlayProps?: RadixDialog.DialogOverlayProps;
  contentProps?: RadixDialog.DialogContentProps;
}

export const Root = (props: DialogProps) => {
  const {
    closeOnInteractOutside = true,
    size = 'md',
    portalProps,
    overlayProps,
    contentProps,
    children,
    ...rootProps
  } = props;

  return (
    <RadixDialog.Root {...rootProps}>
      <RadixDialog.Portal {...portalProps}>
        <RadixDialog.Overlay
          {...overlayProps}
          className={clsx(dialogStyles.dialogOverlay, overlayProps?.className)} />
        <RadixDialog.Content
          {...contentProps}
          className={clsx(
            size === 'xl' ? dialogStyles.dialogContentXLarge
              : size === 'lg' ? dialogStyles.dialogContentLarge
                : dialogStyles.dialogContent,
            contentProps?.className
          )}
          onInteractOutside={contentProps?.onInteractOutside ?? (
            closeOnInteractOutside ? undefined : ((e) => {
              e.preventDefault();
            })
          )}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export const Title = (props: RadixDialog.DialogTitleProps) => {
  return (
    <RadixDialog.Title
      {...props}
      className={clsx(dialogStyles.dialogTitle, props.className)}
    />
  );
};

export const Description = (props: RadixDialog.DialogDescriptionProps) => {
  return (
    <RadixDialog.Description
      {...props}
      className={clsx(dialogStyles.dialogDescription, props.className)}
    />
  );
};

export const Footer = (props: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      {...props}
      className={clsx(dialogStyles.dialogFooter, props.className)}
    />
  );
};

export const Button = (props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'normal' | 'primary' | 'danger';
}) => {
  const { variant, className, ...rest } = props;
  return (
    <button
      {...rest}
      className={clsx(
        dialogStyles.dialogButton,
        variant === 'primary' && dialogStyles.dialogButtonPrimary,
        variant === 'danger' && dialogStyles.dialogButtonDanger,
        className
      )}
    />
  );
};

export const CloseButton = (props: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  closeProps?: RadixDialog.DialogCloseProps;
}) => {
  const { closeProps, className, ...buttonProps } = props;
  return (
    <RadixDialog.Close asChild {...closeProps}>
      <button
        className={clsx(dialogStyles.dialogClose, className)}
        aria-label="Close"
        {...buttonProps}
      >
        <X size={16} />
      </button>
    </RadixDialog.Close>
  );
};

export const Body = (props: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      {...props}
      className={clsx(dialogStyles.dialogBody, props.className)}
    />
  );
};

export const Separator = (props: React.HTMLAttributes<HTMLDivElement> & {
  vertical?: boolean;
}) => {
  return (
    <div {...props} className={clsx(dialogStyles.dialogSeparator, props.vertical && 'vertical')} />
  );
};

export const Trigger = RadixDialog.Trigger;
export const Close = RadixDialog.Close;
