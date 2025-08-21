import { createContext, useContext } from "react";
import { StoreApi, UseBoundStore } from "zustand";

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