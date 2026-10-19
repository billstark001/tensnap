import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ContentIsland } from '../../workbench/portal-content';
import clsx from 'clsx';
import { WindowTypeContext } from '../../workbench/dialog-content';
import { getDialogHost, type ContentWindow, type WindowOptions } from '../../workbench/content';
import * as styles from './Dialog.css';

export interface DialogProps {
  title: string;
  type?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: WindowOptions['size'];
  modal?: boolean;
  dismissible?: boolean;
  children?: ReactNode;
}
const DialogContainerContext = createContext<HTMLElement | undefined>(undefined);
export const useDialogContainer = () => useContext(DialogContainerContext);
const DialogContext = createContext<(() => void) | null>(null);
export function Root({
  title,
  type,
  open = false,
  onOpenChange,
  size = 'md',
  modal = false,
  dismissible = true,
  children,
}: DialogProps) {
  const registeredType = useContext(WindowTypeContext);
  const windowType = type ?? registeredType;
  const [content, setContent] = useState<ContentWindow | null>(null);
  const options = useRef<WindowOptions>(null!);
  useLayoutEffect(() => {
    options.current = {
      title,
      type: windowType,
      size,
      modal,
      dismissible,
      onClose: () => onOpenChange?.(false),
    };
  });
  useLayoutEffect(() => {
    if (!open) return;
    const window = getDialogHost().create(options.current);
    window.element.dataset.dialogSize = size;
    setContent(window);
    return () => {
      window.dispose();
      setContent(null);
    };
  }, [open]);
  useLayoutEffect(() => {
    content?.update(options.current);
  });
  return content ? (
    <ContentIsland host={content.element}>
      <DialogContainerContext.Provider value={content.element}>
        <DialogContext.Provider value={() => onOpenChange?.(false)}>
          {children}
        </DialogContext.Provider>
      </DialogContainerContext.Provider>
    </ContentIsland>
  ) : null;
}
export const Description = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  (props, ref) => {
    const id = useId();
    return (
      <p
        {...props}
        id={props.id ?? id}
        data-dialog-description
        ref={ref}
        className={clsx(styles.dialogDescription, props.className)}
      />
    );
  },
);
export const Footer = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div {...props} ref={ref} className={clsx(styles.dialogFooter, props.className)} />
));
export const Body = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div {...props} ref={ref} className={clsx(styles.dialogBody, props.className)} />
));
export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'normal' | 'primary' | 'danger' }
>(({ variant, className, ...props }, ref) => (
  <button
    type="button"
    {...props}
    ref={ref}
    className={clsx(
      styles.dialogButton,
      variant === 'primary' && styles.dialogButtonPrimary,
      variant === 'danger' && styles.dialogButtonDanger,
      className,
    )}
  />
));
export function Close({
  asChild,
  children,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const close = useContext(DialogContext);
  const click: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] = (event) => {
    onClick?.(event);
    if (!event.defaultPrevented) close?.();
  };
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
    return cloneElement(child, {
      ...props,
      onClick: (event) => {
        child.props.onClick?.(event);
        if (!event.defaultPrevented) click(event);
      },
    });
  }
  return (
    <button type="button" {...props} onClick={click}>
      {children}
    </button>
  );
}
export const Separator = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { vertical?: boolean }
>(({ vertical, ...props }, ref) => (
  <div {...props} ref={ref} className={clsx(styles.dialogSeparator, vertical && 'vertical')} />
));
export default { Root, Description, Footer, Body, Button, Close, Separator };
