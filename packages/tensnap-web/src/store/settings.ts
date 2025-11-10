import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Locale } from '@/i18n';

type Theme = 'light' | 'dark';
type ValidationLevel = 'off' | 'warning' | 'error';

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
  
  // Validation settings
  clientMessageValidation: ValidationLevel;
  serverMessageValidation: ValidationLevel;
  
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSaveFormat: (format: 'json' | 'msgpack') => void;
  setLocale: (locale: Locale) => void;
  setClientMessageValidation: (level: ValidationLevel) => void;
  setServerMessageValidation: (level: ValidationLevel) => void;
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

    // Initialize validation settings from localStorage
    clientMessageValidation: (() => {
      const saved = localStorage.getItem('clientMessageValidation');
      return (saved as ValidationLevel) || 'off';
    })(),

    serverMessageValidation: (() => {
      const saved = localStorage.getItem('serverMessageValidation');
      return (saved as ValidationLevel) || 'off';
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

    setClientMessageValidation: (level: ValidationLevel) => {
      set({ clientMessageValidation: level });
    },

    setServerMessageValidation: (level: ValidationLevel) => {
      set({ serverMessageValidation: level });
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

useSettingsStore.subscribe(
  (state) => state.clientMessageValidation,
  (level) => {
    localStorage.setItem('clientMessageValidation', level);
  }
);

useSettingsStore.subscribe(
  (state) => state.serverMessageValidation,
  (level) => {
    localStorage.setItem('serverMessageValidation', level);
  }
);
