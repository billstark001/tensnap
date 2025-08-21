import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface SettingsStore {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    // 从 localStorage 初始化主题
    theme: (() => {
      const saved = localStorage.getItem('theme');
      return (saved as Theme) || 'light';
    })(),

    toggleTheme: () => {
      const currentTheme = get().theme;
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      set({ theme: newTheme });
    },

    setTheme: (theme: Theme) => {
      set({ theme });
    },
  }))
);

// 订阅主题变化，自动更新 DOM 和 localStorage
useSettingsStore.subscribe(
  (state) => state.theme,
  (theme) => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }
);
