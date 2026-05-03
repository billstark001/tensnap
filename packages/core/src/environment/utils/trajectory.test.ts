import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRAJECTORY_COLOR,
  DEFAULT_TRAJECTORY_CONFIG,
  resolveTrajectoryConfig,
  resolveTrajectoryRenderStyle,
  splitTrajectoryPoints,
} from './trajectory';

describe('resolveTrajectoryConfig', () => {
  it('falls back to core defaults when values are omitted', () => {
    expect(resolveTrajectoryConfig({ width: undefined, color: undefined })).toEqual(DEFAULT_TRAJECTORY_CONFIG);
  });

  it('prefers explicit values and falls back to the provided base config', () => {
    expect(resolveTrajectoryConfig(
      { width: undefined, color: '#f59e0b' },
      { length: 12, width: 4, color: '#2563eb' },
    )).toEqual({
      length: 12,
      width: 4,
      color: '#f59e0b',
    });
  });
});

describe('resolveTrajectoryRenderStyle', () => {
  it('prefers point colors and still supplies a default width', () => {
    expect(resolveTrajectoryRenderStyle([
      { x: 0, y: 0, time: 0 },
      { x: 1, y: 1, time: 1, color: '#f59e0b' },
    ], { width: undefined, color: undefined })).toEqual({
      width: 2,
      color: '#f59e0b',
    });
  });

  it('falls back to the core default color when no color is specified anywhere', () => {
    expect(resolveTrajectoryRenderStyle([
      { x: 0, y: 0, time: 0 },
      { x: 1, y: 1, time: 1 },
    ], { width: 3, color: undefined })).toEqual({
      width: 3,
      color: DEFAULT_TRAJECTORY_COLOR,
    });
  });
});

describe('splitTrajectoryPoints', () => {
  it('keeps a contiguous trajectory as one segment', () => {
    expect(splitTrajectoryPoints([
      { x: 1, y: 1, time: 0 },
      { x: 2, y: 2, time: 1 },
      { x: 3, y: 2.5, time: 2 },
    ], { width: 10, height: 10 })).toEqual([[
      { x: 1, y: 1, time: 0 },
      { x: 2, y: 2, time: 1 },
      { x: 3, y: 2.5, time: 2 },
    ]]);
  });

  it('breaks a segment when x wraps across the world boundary', () => {
    expect(splitTrajectoryPoints([
      { x: 9.6, y: 5, time: 0 },
      { x: 0.2, y: 5.1, time: 1 },
      { x: 0.9, y: 5.2, time: 2 },
    ], { width: 10, height: 10 })).toEqual([[
      { x: 0.2, y: 5.1, time: 1 },
      { x: 0.9, y: 5.2, time: 2 },
    ]]);
  });

  it('breaks a segment when y wraps across the world boundary', () => {
    expect(splitTrajectoryPoints([
      { x: 4, y: 9.7, time: 0 },
      { x: 4.2, y: 0.1, time: 1 },
      { x: 4.4, y: 0.6, time: 2 },
    ], { width: 10, height: 10 })).toEqual([[
      { x: 4.2, y: 0.1, time: 1 },
      { x: 4.4, y: 0.6, time: 2 },
    ]]);
  });

  it('does not split large jumps when world bounds are unavailable', () => {
    expect(splitTrajectoryPoints([
      { x: 9.6, y: 5, time: 0 },
      { x: 0.2, y: 5.1, time: 1 },
      { x: 0.9, y: 5.2, time: 2 },
    ])).toEqual([[
      { x: 9.6, y: 5, time: 0 },
      { x: 0.2, y: 5.1, time: 1 },
      { x: 0.9, y: 5.2, time: 2 },
    ]]);
  });
});