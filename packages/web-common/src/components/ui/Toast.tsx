import * as RadixToast from '@radix-ui/react-toast';
import * as toastStyles from './Toast.css';
import clsx from 'clsx';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export type ToastStatus = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  title?: string;
  description?: string;
  status?: ToastStatus;
  duration?: number;
  isClosable?: boolean;
  onClose?: () => void;
}

const statusIconMap = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const statusColorMap = {
  success: '#00cc66',
  error: '#cc0000',
  warning: '#ffcc00',
  info: '#00cccc',
};

const statusClassMap = {
  success: toastStyles.toastSuccess,
  error: toastStyles.toastError,
  warning: toastStyles.toastWarning,
  info: toastStyles.toastInfo,
};

export function Toast({
  title,
  description,
  status = 'info',
  duration = 5000,
  isClosable = true,
  onClose,
}: ToastProps) {
  const [open, setOpen] = useState(true);
  const [progress, setProgress] = useState(100);
  const Icon = statusIconMap[status];

  useEffect(() => {
    if (!duration || duration === Infinity) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
    }, 16);

    return () => clearInterval(interval);
  }, [duration]);

  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    if (!open) {
      onClose?.();
    }
  };

  return (
    <RadixToast.Root
      className={clsx(toastStyles.toastRoot, statusClassMap[status])}
      open={open}
      onOpenChange={handleOpenChange}
      duration={duration === Infinity ? Infinity : duration}
    >
      <div className={toastStyles.toastIconWrapper}>
        <Icon size={20} color={statusColorMap[status]} />
      </div>

      <div className={toastStyles.toastContent}>
        {title && (
          <RadixToast.Title className={toastStyles.toastTitle}>
            {title}
          </RadixToast.Title>
        )}
        {description && (
          <RadixToast.Description className={toastStyles.toastDescription}>
            {description}
          </RadixToast.Description>
        )}
      </div>

      {isClosable && (
        <RadixToast.Close className={toastStyles.toastClose}>
          <X size={16} />
        </RadixToast.Close>
      )}

      {duration !== Infinity && (
        <div
          className={toastStyles.toastProgress}
          style={{
            transform: `scaleX(${progress / 100})`,
            transitionDuration: `${duration}ms`,
          }}
        />
      )}
    </RadixToast.Root>
  );
}

export interface ToastContainerProps {
  toasts: ToastProps[];
}

export function ToastContainer({ toasts }: ToastContainerProps) {
  return (
    <RadixToast.Provider swipeDirection="right">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} />
      ))}
      <RadixToast.Viewport className={toastStyles.toastViewport} />
    </RadixToast.Provider>
  );
}

export default {
  Container: ToastContainer,
  Toast,
};
