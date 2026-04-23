import { createToastStore } from '@/utils/zustand';
import { useMemo } from 'react';

export const [useToastStore, ToastAnchor] = createToastStore();

export const useToast = () => {
  const success = useToastStore((store) => store.success);
  const error = useToastStore((store) => store.error);
  const warning = useToastStore((store) => store.warning);
  const info = useToastStore((store) => store.info);

  const stableObject = useMemo(() => ({ success, error, warning, info }), [success, error, warning, info]);

  return stableObject;
};

export const getToastState = () => {
  const { success, error, warning, info } = useToastStore.getState();
  return {
    success,
    error,
    warning,
    info,
  };
};


