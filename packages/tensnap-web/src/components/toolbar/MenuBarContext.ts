import { createContext } from 'react';

export type MenuBarConfig = {
  environment: 'tauri' | 'web';
  system: 'mac' | 'other';
  isFullscreen: boolean;
  onExit?: () => void | Promise<void>;
  onToggleFullscreen?: () => void | Promise<void>;
};

export const MenuBarContext = createContext<MenuBarConfig>({
  environment: 'web',
  system: 'other',
  isFullscreen: false,
});
