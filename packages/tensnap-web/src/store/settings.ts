import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Locale } from '@/i18n';

type Theme = 'light' | 'dark';
type ValidationLevel = 'off' | 'warning' | 'error';
export type RenderTriggerMode = 'auto' | 'setTimeout' | 'requestAnimationFrame';

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
  renderTriggerMode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
  runtimeTps: number | null;
  runtimeMspt: number | null;
  
  // Validation settings
  clientMessageValidation: ValidationLevel;
  serverMessageValidation: ValidationLevel;
  
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSaveFormat: (format: 'json' | 'msgpack') => void;
  setLocale: (locale: Locale) => void;
  setClientMessageValidation: (level: ValidationLevel) => void;
  setServerMessageValidation: (level: ValidationLevel) => void;
  setRenderTriggerMode: (mode: RenderTriggerMode) => void;
  setMaxTps: (fps: number) => void;
  setMaxRenderFps: (fps: number) => void;
  setRuntimeMetrics: (metrics: { tps: number | null; mspt: number | null }) => void;
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

    renderTriggerMode: (() => {
      const saved = localStorage.getItem('renderTriggerMode');
      if (saved === 'setTimeout' || saved === 'requestAnimationFrame' || saved === 'auto') {
        return saved;
      }
      return 'auto';
    })(),

    maxTps: (() => {
      const saved = localStorage.getItem('maxTps');
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
      return 300;
    })(),

    maxRenderFps: (() => {
      const saved = localStorage.getItem('maxRenderFps');
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
      return 120;
    })(),

    runtimeTps: null,
    runtimeMspt: null,

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

    setRenderTriggerMode: (mode: RenderTriggerMode) => {
      set({ renderTriggerMode: mode });
    },

    setMaxTps: (fps: number) => {
      const next = Number.isFinite(fps) ? Math.max(0, Math.floor(fps)) : 300;
      set({ maxTps: next });
    },

    setMaxRenderFps: (fps: number) => {
      const next = Number.isFinite(fps) ? Math.max(0, Math.floor(fps)) : 120;
      set({ maxRenderFps: next });
    },

    setRuntimeMetrics: (metrics: { tps: number | null; mspt: number | null }) => {
      set({ runtimeTps: metrics.tps, runtimeMspt: metrics.mspt });
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

useSettingsStore.subscribe(
  (state) => state.renderTriggerMode,
  (mode) => {
    localStorage.setItem('renderTriggerMode', mode);
  }
);

useSettingsStore.subscribe(
  (state) => state.maxTps,
  (fps) => {
    localStorage.setItem('maxTps', String(fps));
  }
);

useSettingsStore.subscribe(
  (state) => state.maxRenderFps,
  (fps) => {
    localStorage.setItem('maxRenderFps', String(fps));
  }
);
