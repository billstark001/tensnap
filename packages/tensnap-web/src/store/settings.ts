import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

type Theme = 'light' | 'dark';

interface SettingsStore {

  settingsDialogOpen: boolean;
  setSettingsDialogOpen: (open: boolean) => void;

  theme: Theme;
  saveFormat: 'json' | 'msgpack';
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSaveFormat: (format: 'json' | 'msgpack') => void;
}

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({

    settingsDialogOpen: false,

    setSettingsDialogOpen: (open: boolean) => {
      set({ settingsDialogOpen: open });
    },

    // 从 localStorage 初始化主题
    theme: (() => {
      const saved = localStorage.getItem('theme');
      return (saved as Theme) || 'light';
    })(),

    saveFormat: (() => {
      const saved = localStorage.getItem('saveFormat');
      return (saved as 'json' | 'msgpack') || 'msgpack';
    })(),

    toggleTheme: () => {
      const currentTheme = get().theme;
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      set({ theme: newTheme });
    },

    setTheme: (theme: Theme) => {
      set({ theme });
    },

    setSaveFormat: (format: 'json' | 'msgpack') => {
      set({ saveFormat: format });
    },
  }))
);

useSettingsStore.subscribe(
  (state) => state.theme,
  (theme) => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }
);

useSettingsStore.subscribe(
  (state) => state.saveFormat,
  (format) => {
    localStorage.setItem('saveFormat', format);
  }
);
