import { afterEach, describe, expect, it } from 'vitest';
import { MAX_SNAPSHOT_PLAYBACK_FPS, useSettingsStore } from './settings';

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
