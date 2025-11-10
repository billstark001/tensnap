import { DialogProps } from "@radix-ui/react-dialog";
import { createContext, useContext } from "react";
import { create, StoreApi, UseBoundStore } from "zustand";
import { ToastContainer, ToastProps, ToastStatus } from "@/components/ui/Toast";

export type CreateStoreFunction<T, TExternal = object> = (
  set: {
    (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: false): void;
    (state: T | ((state: T) => T), replace: true): void;
  },
  get: () => T & TExternal,
  store: StoreApi<T>
) => T;

type FakeUseBoundStore<T> = {
  (): T | undefined;
  <U>(selector: (state: T) => U): U | undefined;
};

export const createStoreContext = <T,>() => {

  const context = createContext<UseBoundStore<StoreApi<T>> | undefined>(undefined);

  const Provider = context.Provider;

  const useStore = ((...args: any[]) => {
    const ctx = useContext(context);
    if (!ctx) {
      return undefined;
    }
    return ctx(...args as []);
  }) as FakeUseBoundStore<T>;

  return { context, Provider, useStore };
};

type MinimalDialogProps = Pick<DialogProps, 'open' | 'onOpenChange'>;
type DialogStateOmitted<T> = Omit<T, 'open' | 'onOpenChange'>;

export interface DialogStore<T extends MinimalDialogProps = MinimalDialogProps, R = void> {
  open: boolean;
  options?: DialogStateOmitted<T>;
  resolve?: (result: R) => void;
  // actions
  invoke: (options?: DialogStateOmitted<T>) => Promise<R>;
  closeDialog: (result?: R) => void;
}

export const createDialogStore = <T extends MinimalDialogProps, R = void>(
  MyDialog: React.ComponentType<T>,
  resolver?: (resolve: (result: R) => void) => Partial<DialogStateOmitted<T>>,
  defaultResolvedValue?: R,
) => {

  const useDialogStore = create<DialogStore<T, R>>((set) => ({
    open: false,
    options: undefined,
    resolve: undefined,

    invoke: (options) => {
      return new Promise<R>((resolve) => {
        set({
          open: true, options: {
            ...resolver?.(resolve),
            ...options,
          } as any, resolve
        });
      });
    },

    closeDialog: (result?: R) => {
      set((state) => {
        state.resolve?.(result ?? defaultResolvedValue as R);
        return { open: false, options: undefined, resolve: undefined };
      });
    },
  }));

  function DialogAnchor() {
    const { open, options, closeDialog } = useDialogStore();
    return (
      <MyDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            closeDialog();
          }
        }}
        {...options as any}
      />
    );
  }

  return [useDialogStore, DialogAnchor] as const;
}

// Toast Store
export interface ToastOptions {
  title?: string;
  description?: string;
  status?: ToastStatus;
  duration?: number;
  isClosable?: boolean;
}

export interface ToastStore {
  toasts: ToastProps[];
  // actions
  toast: (options: ToastOptions) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  close: (id: string) => void;
  closeAll: () => void;
}

let toastIdCounter = 0;

export const createToastStore = () => {
  const useToastStore = create<ToastStore>((set, get) => ({
    toasts: [],

    toast: (options: ToastOptions) => {
      const id = `toast-${++toastIdCounter}`;
      const toast: ToastProps = {
        id,
        ...options,
        onClose: () => {
          get().close(id);
        },
      };
      
      set((state) => ({
        toasts: [...state.toasts, toast],
      }));
      
      return id;
    },

    success: (title: string, description?: string) => {
      return get().toast({ title, description, status: 'success' });
    },

    error: (title: string, description?: string) => {
      return get().toast({ title, description, status: 'error' });
    },

    warning: (title: string, description?: string) => {
      return get().toast({ title, description, status: 'warning' });
    },

    info: (title: string, description?: string) => {
      return get().toast({ title, description, status: 'info' });
    },

    close: (id: string) => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    },

    closeAll: () => {
      set({ toasts: [] });
    },
  }));

  function ToastAnchor() {
    const toasts = useToastStore((state) => state.toasts);
    return <ToastContainer toasts={toasts} />;
  }

  return [useToastStore, ToastAnchor] as const;
};