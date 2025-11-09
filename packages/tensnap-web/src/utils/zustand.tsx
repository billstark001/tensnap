import { DialogProps } from "@radix-ui/react-dialog";
import { createContext, useContext } from "react";
import { create, StoreApi, UseBoundStore } from "zustand";

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