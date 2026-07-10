import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { Locale } from '@/i18n';
import { getSettingsPersistence } from './settings-persistence';

export type { RenderTriggerMode } from '@tensnap/core/runtime/browser';
import type { RenderTriggerMode } from '@tensnap/core/runtime/browser';

export type Theme = 'light' | 'dark';
type ValidationLevel = 'off' | 'warning' | 'error';
export const ACTION_TIMEOUT_SECONDS_OPTIONS = [1, 5, 10, 30, 60] as const;
export type ActionTimeoutSeconds = typeof ACTION_TIMEOUT_SECONDS_OPTIONS[number];

export interface ContinuousRunProfile {
  maxSteps: number;
  stopWhen?: string;
  maxWallTimeMs?: number;
  record: boolean;
}

function parseRunProfiles(raw: string | null): Record<string, ContinuousRunProfile> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ContinuousRunProfile>>;
    return Object.fromEntries(Object.entries(parsed).flatMap(([actionId, profile]) => {
      if (!Number.isInteger(profile.maxSteps) || (profile.maxSteps ?? 0) < 1) return [];
      return [[actionId, {
        maxSteps: profile.maxSteps!,
        stopWhen: typeof profile.stopWhen === 'string' && profile.stopWhen.trim() ? profile.stopWhen : undefined,
        maxWallTimeMs: typeof profile.maxWallTimeMs === 'number' && profile.maxWallTimeMs > 0
          ? profile.maxWallTimeMs
          : undefined,
        record: profile.record === true,
      }]];
    }));
  } catch {
    return {};
  }
}

function parseNonNegativeInteger(raw: string | null, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseActionTimeout(raw: string | null): ActionTimeoutSeconds {
  const parsed = raw ? Number(raw) : NaN;
  return ACTION_TIMEOUT_SECONDS_OPTIONS.includes(parsed as ActionTimeoutSeconds)
    ? parsed as ActionTimeoutSeconds
    : 5;
}

export async function hydrateSettings(): Promise<void> {
  const persistence = getSettingsPersistence();
  const keys = [
    'theme',
    'saveFormat',
    'locale',
    'renderTriggerMode',
    'maxTps',
    'maxRenderFps',
    'actionTimeoutSeconds',
    'continuousRunProfiles',
    'clientMessageValidation',
    'serverMessageValidation',
  ] as const;
  const values = await Promise.all(keys.map((key) => persistence.get(key)));
  const setting = Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<typeof keys[number], string | null>;

  useSettingsStore.setState({
    theme: setting.theme === 'dark' ? 'dark' : 'light',
    saveFormat: setting.saveFormat === 'json' ? 'json' : 'msgpack',
    locale: setting.locale === 'zh' || setting.locale === 'ja' ? setting.locale : 'en',
    renderTriggerMode: setting.renderTriggerMode === 'setTimeout' || setting.renderTriggerMode === 'requestAnimationFrame' || setting.renderTriggerMode === 'auto'
      ? setting.renderTriggerMode
      : 'auto',
    maxTps: parseNonNegativeInteger(setting.maxTps, 300),
    maxRenderFps: parseNonNegativeInteger(setting.maxRenderFps, 120),
    actionTimeoutSeconds: parseActionTimeout(setting.actionTimeoutSeconds),
    continuousRunProfiles: parseRunProfiles(setting.continuousRunProfiles),
    clientMessageValidation: setting.clientMessageValidation === 'warning' || setting.clientMessageValidation === 'error'
      ? setting.clientMessageValidation
      : 'off',
    serverMessageValidation: setting.serverMessageValidation === 'warning' || setting.serverMessageValidation === 'error'
      ? setting.serverMessageValidation
      : 'off',
  });
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
  actionTimeoutSeconds: ActionTimeoutSeconds;
  continuousRunProfiles: Record<string, ContinuousRunProfile>;
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
  setActionTimeoutSeconds: (seconds: number) => void;
  setContinuousRunProfile: (actionId: string, profile: ContinuousRunProfile) => void;
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

    theme: 'light',
    saveFormat: 'msgpack',
    locale: 'en',
    renderTriggerMode: 'auto',
    maxTps: 300,
    maxRenderFps: 120,
    actionTimeoutSeconds: 5,
    continuousRunProfiles: {},

    runtimeTps: null,
    runtimeMspt: null,
  simulatorMspt: null,
  simulatorCommMs: null,
  simulatorRenderMs: null,

    clientMessageValidation: 'off',
    serverMessageValidation: 'off',

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

    setActionTimeoutSeconds: (seconds: number) => {
      const next = ACTION_TIMEOUT_SECONDS_OPTIONS.includes(seconds as ActionTimeoutSeconds)
        ? seconds as ActionTimeoutSeconds
        : 5;
      set({ actionTimeoutSeconds: next });
    },

    setContinuousRunProfile: (actionId, profile) => {
      set((state) => ({
        continuousRunProfiles: {
          ...state.continuousRunProfiles,
          [actionId]: { ...profile },
        },
      }));
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
    void getSettingsPersistence().set('theme', theme);
  }
);

useSettingsStore.subscribe(
  (state) => state.saveFormat,
  (format) => {
    void getSettingsPersistence().set('saveFormat', format);
  }
);

useSettingsStore.subscribe(
  (state) => state.locale,
  (locale) => {
    void getSettingsPersistence().set('locale', locale);
  }
);

useSettingsStore.subscribe(
  (state) => state.clientMessageValidation,
  (level) => {
    void getSettingsPersistence().set('clientMessageValidation', level);
  }
);

useSettingsStore.subscribe(
  (state) => state.serverMessageValidation,
  (level) => {
    void getSettingsPersistence().set('serverMessageValidation', level);
  }
);

useSettingsStore.subscribe(
  (state) => state.renderTriggerMode,
  (mode) => {
    void getSettingsPersistence().set('renderTriggerMode', mode);
  }
);

useSettingsStore.subscribe(
  (state) => state.maxTps,
  (fps) => {
    void getSettingsPersistence().set('maxTps', String(fps));
  }
);

useSettingsStore.subscribe(
  (state) => state.maxRenderFps,
  (fps) => {
    void getSettingsPersistence().set('maxRenderFps', String(fps));
  }
);

useSettingsStore.subscribe(
  (state) => state.actionTimeoutSeconds,
  (seconds) => {
    void getSettingsPersistence().set('actionTimeoutSeconds', String(seconds));
  }
);

useSettingsStore.subscribe(
  (state) => state.continuousRunProfiles,
  (profiles) => {
    void getSettingsPersistence().set('continuousRunProfiles', JSON.stringify(profiles));
  },
);
