import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Locale } from '@/i18n';

export type { RenderTriggerMode } from '@tensnap/core/runtime/browser';
import type { RenderTriggerMode } from '@tensnap/core/runtime/browser';

type Theme = 'light' | 'dark';
type ValidationLevel = 'off' | 'warning' | 'error';

function readSetting(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage can be unavailable in tests, SSR, or private browsing modes.
  }
}

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
  simulatorMspt: number | null;
  simulatorCommMs: number | null;
  simulatorRenderMs: number | null;
  
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
  setSimulatorMetrics: (metrics?: { simulate_ms?: number; communicate_ms?: number; render_ms?: number }) => void;
  clearRuntimeMetrics: () => void;
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
      const saved = readSetting('theme');
      return (saved as Theme) || 'light';
    })(),

    saveFormat: (() => {
      const saved = readSetting('saveFormat');
      return (saved as 'json' | 'msgpack') || 'msgpack';
    })(),

    locale: (() => {
      const saved = readSetting('locale');
      return (saved as Locale) || 'en';
    })(),

    renderTriggerMode: (() => {
      const saved = readSetting('renderTriggerMode');
      if (saved === 'setTimeout' || saved === 'requestAnimationFrame' || saved === 'auto') {
        return saved;
      }
      return 'auto';
    })(),

    maxTps: (() => {
      const saved = readSetting('maxTps');
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
      return 300;
    })(),

    maxRenderFps: (() => {
      const saved = readSetting('maxRenderFps');
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.floor(parsed);
      }
      return 120;
    })(),

    runtimeTps: null,
    runtimeMspt: null,
  simulatorMspt: null,
  simulatorCommMs: null,
  simulatorRenderMs: null,

    // Initialize validation settings from localStorage
    clientMessageValidation: (() => {
      const saved = readSetting('clientMessageValidation');
      return (saved as ValidationLevel) || 'off';
    })(),

    serverMessageValidation: (() => {
      const saved = readSetting('serverMessageValidation');
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

    setSimulatorMetrics: (metrics) => {
      set({
        simulatorMspt: metrics?.simulate_ms ?? null,
        simulatorCommMs: metrics?.communicate_ms ?? null,
        simulatorRenderMs: metrics?.render_ms ?? null,
      });
    },

    clearRuntimeMetrics: () => {
      set({
        runtimeTps: null,
        runtimeMspt: null,
        simulatorMspt: null,
        simulatorCommMs: null,
        simulatorRenderMs: null,
      });
    },
  }))
);

useSettingsStore.subscribe(
  (state) => state.theme,
  (theme) => {
    globalThis.document?.body?.setAttribute('data-theme', theme);
    writeSetting('theme', theme);
  }
);

useSettingsStore.subscribe(
  (state) => state.saveFormat,
  (format) => {
    writeSetting('saveFormat', format);
  }
);

useSettingsStore.subscribe(
  (state) => state.locale,
  (locale) => {
    writeSetting('locale', locale);
  }
);

useSettingsStore.subscribe(
  (state) => state.clientMessageValidation,
  (level) => {
    writeSetting('clientMessageValidation', level);
  }
);

useSettingsStore.subscribe(
  (state) => state.serverMessageValidation,
  (level) => {
    writeSetting('serverMessageValidation', level);
  }
);

useSettingsStore.subscribe(
  (state) => state.renderTriggerMode,
  (mode) => {
    writeSetting('renderTriggerMode', mode);
  }
);

useSettingsStore.subscribe(
  (state) => state.maxTps,
  (fps) => {
    writeSetting('maxTps', String(fps));
  }
);

useSettingsStore.subscribe(
  (state) => state.maxRenderFps,
  (fps) => {
    writeSetting('maxRenderFps', String(fps));
  }
);
