import { createContext } from 'react';

export type MenuBarConfig = {
  environment: 'tauri' | 'web';
  system: 'mac' | 'other';
};

export const MenuBarContext = createContext<MenuBarConfig>({
  environment: 'web',
  system: 'other',
});