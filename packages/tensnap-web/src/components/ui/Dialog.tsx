import * as RadixDialog from '@radix-ui/react-dialog';
import * as dialogStyles from './Dialog.css';
import clsx from 'clsx';

export interface DialogProps extends RadixDialog.DialogProps {
  closeOnInteractOutside?: boolean;
  portalProps?: RadixDialog.DialogPortalProps;
  overlayProps?: RadixDialog.DialogOverlayProps;
  contentProps?: RadixDialog.DialogContentProps;
}

export const SimpleDialog = (props: DialogProps) => {
  const {
    closeOnInteractOutside = true,
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
          className={clsx(dialogStyles.dialogContent, contentProps?.className)}
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
