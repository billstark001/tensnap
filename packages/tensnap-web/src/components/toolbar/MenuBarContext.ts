import { createContext } from 'react';

export const DOCUMENTATION_URL = 'https://github.com/billstark001/tensnap/tree/main/docs';
export function openBrowserDocumentation(): void {
  window.open(DOCUMENTATION_URL, '_blank', 'noopener,noreferrer');
}

export type MenuBarConfig = {
  environment: 'tauri' | 'web';
  system: 'mac' | 'other';
  isFullscreen: boolean;
  onOpenDocumentation: () => void | Promise<void>;
  onExit?: () => void | Promise<void>;
  onToggleFullscreen?: () => void | Promise<void>;
};

export const MenuBarContext = createContext<MenuBarConfig>({
  onOpenDocumentation: openBrowserDocumentation,
  environment: 'web',
  system: 'other',
  isFullscreen: false,
});
