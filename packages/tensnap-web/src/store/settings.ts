import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Locale } from '@/i18n';

type Theme = 'light' | 'dark';

interface SettingsStore {

  settingsDialogOpen: boolean;
  setSettingsDialogOpen: (open: boolean) => void;

  aboutDialogOpen: boolean;
  setAboutDialogOpen: (open: boolean) => void;

  isAdjusting: boolean;
  setIsAdjusting: (isAdjusting: boolean) => void;

  theme: Theme;
  saveFormat: 'json' | 'msgpack';
  locale: Locale;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSaveFormat: (format: 'json' | 'msgpack') => void;
  setLocale: (locale: Locale) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({

    settingsDialogOpen: false,

    setSettingsDialogOpen: (open: boolean) => {
      set({ settingsDialogOpen: open });
    },

    aboutDialogOpen: false,

    setAboutDialogOpen: (open: boolean) => {
      set({ aboutDialogOpen: open });
    },

    isAdjusting: false,

    setIsAdjusting: (isAdjusting: boolean) => {
      set({ isAdjusting });
    },

    // Initialize from localStorage
    theme: (() => {
      const saved = localStorage.getItem('theme');
      return (saved as Theme) || 'light';
    })(),

    saveFormat: (() => {
      const saved = localStorage.getItem('saveFormat');
      return (saved as 'json' | 'msgpack') || 'msgpack';
    })(),

    locale: (() => {
      const saved = localStorage.getItem('locale');
      return (saved as Locale) || 'en';
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

    setLocale: (locale: Locale) => {
      set({ locale });
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

useSettingsStore.subscribe(
  (state) => state.locale,
  (locale) => {
    localStorage.setItem('locale', locale);
  }
);
