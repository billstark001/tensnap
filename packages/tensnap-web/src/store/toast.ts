import { createToastStore } from '@/utils/zustand';

export const [useToastStore, ToastAnchor] = createToastStore();

export const useToast = () => {
  const success = useToastStore((store) => store.success);
  const error = useToastStore((store) => store.error);
  const warning = useToastStore((store) => store.warning);
  const info = useToastStore((store) => store.info);

  return {
    success,
    error,
    warning,
    info,
  };
}
