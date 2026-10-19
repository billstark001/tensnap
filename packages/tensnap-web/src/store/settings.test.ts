import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateSettings, MAX_SNAPSHOT_PLAYBACK_FPS, useSettingsStore } from './settings';
import {
  configureSettingsPersistence,
  getSettingsPersistence,
} from '@tensnap/web-common/settings-persistence';

describe('snapshot playback settings', () => {
  const original = useSettingsStore.getState().snapshotPlaybackFps;

  afterEach(() => {
    useSettingsStore.setState({ snapshotPlaybackFps: original });
  });

  it('clamps playback FPS to the supported 1–120 range', () => {
    useSettingsStore.getState().setSnapshotPlaybackFps(0);
    expect(useSettingsStore.getState().snapshotPlaybackFps).toBe(1);

    useSettingsStore.getState().setSnapshotPlaybackFps(MAX_SNAPSHOT_PLAYBACK_FPS + 1);
    expect(useSettingsStore.getState().snapshotPlaybackFps).toBe(MAX_SNAPSHOT_PLAYBACK_FPS);
  });
});

describe('continuous run profile persistence', () => {
  it('keeps valid profiles when another stored entry is malformed', async () => {
    const persistence = getSettingsPersistence();
    const original = useSettingsStore.getState().continuousRunProfiles;
    configureSettingsPersistence({
      keys: async () => [],
      remove: async () => {},
      get: async (key) =>
        key === 'continuousRunProfiles'
          ? JSON.stringify({
              broken: null,
              step: { maxSteps: 4, record: true },
              toString: { maxSteps: 2 },
            })
          : null,
      set: async () => {},
    });
    try {
      await hydrateSettings();
      expect(useSettingsStore.getState().continuousRunProfiles.step).toEqual({
        maxSteps: 4,
        stopWhen: undefined,
        maxWallTimeMs: undefined,
        record: true,
      });
      expect(useSettingsStore.getState().continuousRunProfiles.toString).toMatchObject({
        maxSteps: 2,
      });
      expect(useSettingsStore.getState().continuousRunProfiles.broken).toBeUndefined();
      useSettingsStore.getState().setContinuousRunProfile('step', { maxSteps: 5, record: false });
      expect(Object.getPrototypeOf(useSettingsStore.getState().continuousRunProfiles)).toBeNull();
    } finally {
      configureSettingsPersistence(persistence);
      useSettingsStore.setState({ continuousRunProfiles: original });
    }
  });
});

describe('IP-family system settings', () => {
  it.each(['auto', 'ipv4', 'ipv6', 'invalid', null])(
    'hydrates %s and persists changes',
    async (value) => {
      const original = useSettingsStore.getState();
      const persistence = getSettingsPersistence();
      const set = vi.fn(async () => {});
      configureSettingsPersistence({
        keys: async () => [],
        remove: async () => {},
        get: async (key) => (key === 'ip_family' ? value : null),
        set,
      });
      try {
        await hydrateSettings();
        expect(useSettingsStore.getState().ip_family).toBe(
          value === 'ipv4' || value === 'ipv6' ? value : 'auto',
        );
        useSettingsStore.getState().setIPFamily('ipv6');
        useSettingsStore.getState().setIPFamily('ipv4');
        expect(set).toHaveBeenLastCalledWith('ip_family', 'ipv4');
      } finally {
        useSettingsStore.setState(original);
        configureSettingsPersistence(persistence);
      }
    },
  );
});
