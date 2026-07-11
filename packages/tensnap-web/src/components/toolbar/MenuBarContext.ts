import { createContext } from 'react';

export type MenuBarConfig = {
  environment: 'tauri' | 'web';
  system: 'mac' | 'other';
  isFullscreen: boolean;
};

export const MenuBarContext = createContext<MenuBarConfig>({
  environment: 'web',
  system: 'other',
  isFullscreen: false,
});
