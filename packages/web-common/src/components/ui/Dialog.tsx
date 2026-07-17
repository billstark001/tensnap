import * as RadixDialog from '@radix-ui/react-dialog';
import * as dialogStyles from './Dialog.css';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { forwardRef } from 'react';

export interface DialogProps extends RadixDialog.DialogProps {
  closeOnInteractOutside?: boolean;
  size?: 'md' | 'lg' | 'xl' | 'full';
  portalProps?: RadixDialog.DialogPortalProps;
  overlayProps?: RadixDialog.DialogOverlayProps;
  contentProps?: RadixDialog.DialogContentProps;
}

const dialogContentClassNameMap = {
  md: dialogStyles.dialogContent,
  lg: dialogStyles.dialogContentLarge,
  xl: dialogStyles.dialogContentXLarge,
  full: dialogStyles.dialogContentFull,
};

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
            dialogContentClassNameMap[size],
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

export const Title = forwardRef<HTMLHeadingElement, RadixDialog.DialogTitleProps>((props, ref) => {
  return (
    <RadixDialog.Title
      {...props}
      ref={ref}
      className={clsx(dialogStyles.dialogTitle, props.className)}
    />
  );
});
Title.displayName = 'Dialog.Title';

export const Description = forwardRef<HTMLParagraphElement, RadixDialog.DialogDescriptionProps>((props, ref) => {
  return (
    <RadixDialog.Description
      {...props}
      ref={ref}
      className={clsx(dialogStyles.dialogDescription, props.className)}
    />
  );
});
Description.displayName = 'Dialog.Description';

export const Footer = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
  return (
    <div
      {...props}
      ref={ref}
      className={clsx(dialogStyles.dialogFooter, props.className)}
    />
  );
});
Footer.displayName = 'Dialog.Footer';

export const Button = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'normal' | 'primary' | 'danger';
}>((props, ref) => {
  const { variant, className, ...rest } = props;
  return (
    <button
      {...rest}
      ref={ref}
      className={clsx(
        dialogStyles.dialogButton,
        variant === 'primary' && dialogStyles.dialogButtonPrimary,
        variant === 'danger' && dialogStyles.dialogButtonDanger,
        className
      )}
    />
  );
});
Button.displayName = 'Dialog.Button';

export const CloseButton = forwardRef<HTMLButtonElement, Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  closeProps?: RadixDialog.DialogCloseProps;
}>((props, ref) => {
  const { closeProps, className, ...buttonProps } = props;
  return (
    <RadixDialog.Close asChild {...closeProps}>
      <button
        ref={ref}
        className={clsx(dialogStyles.dialogClose, className)}
        aria-label="Close"
        {...buttonProps}
      >
        <X size={16} />
      </button>
    </RadixDialog.Close>
  );
});
CloseButton.displayName = 'Dialog.CloseButton';

export const Body = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
  return (
    <div
      {...props}
      ref={ref}
      className={clsx(dialogStyles.dialogBody, props.className)}
    />
  );
});
Body.displayName = 'Dialog.Body';

export const Separator = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {
  vertical?: boolean;
}>(({ vertical, ...props }, ref) => {
  return (
    <div {...props} ref={ref} className={clsx(dialogStyles.dialogSeparator, vertical && 'vertical')} />
  );
});
Separator.displayName = 'Dialog.Separator';

export const Trigger = RadixDialog.Trigger;
export const Close = RadixDialog.Close;

export default {
  Root,
  Title,
  Description,
  Body,
  Footer,
  Button,
  CloseButton,
  Separator,
  Trigger,
  Close,
}
