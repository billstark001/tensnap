import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  clearWindowPlacements,
  readWindowPlacement,
  registerWindowType,
  saveWindowPlacement,
  windowGeometry,
} from '@tensnap/web-common/workbench/window-state';
import {
  configureSettingsPersistence,
  getSettingsPersistence,
} from '@tensnap/web-common/settings-persistence';
const original = getSettingsPersistence();
const values = new Map<string, string>();
beforeEach(() => {
  values.clear();
  configureSettingsPersistence({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
    keys: async () => [...values.keys()],
  });
});
afterEach(() => configureSettingsPersistence(original));
it('restores independent dialog classes and clears historical entries without changing other settings', async () => {
  const first = await readWindowPlacement('Inspector');
  const second = await readWindowPlacement('Settings');
  const position = { x: 100, y: 120, width: 680, height: 480 };
  await saveWindowPlacement('Inspector', first.generation, position);
  await saveWindowPlacement('Settings', second.generation, { ...position, x: 400 });
  expect((await readWindowPlacement('Inspector')).placement).toMatchObject(position);
  expect((await readWindowPlacement('Settings')).placement?.x).toBe(400);
  values.set('window-placement:RemovedDialog', '{}');
  values.set('theme', 'dark');
  await clearWindowPlacements();
  expect([...values.keys()]).toEqual(['theme', 'window-placement:generation']);
  expect(values.get('theme')).toBe('dark');
  // A still-open window or an async close callback must not undo the reset.
  await saveWindowPlacement('Inspector', first.generation, position);
  expect((await readWindowPlacement('Inspector')).placement).toBeUndefined();
  const reopened = await readWindowPlacement('Inspector');
  await saveWindowPlacement('Inspector', reopened.generation, position);
  expect((await readWindowPlacement('Inspector')).placement).toMatchObject(position);
});
it('fits saved dimensions onto small displays, including displays with negative coordinates', () => {
  registerWindowType('LargeInspector', { width: 1080, height: 740, minWidth: 640, minHeight: 420 });
  const area = { x: -640, y: 30, width: 600, height: 300 };
  const fitted = windowGeometry('LargeInspector', area, {
    x: 3000,
    y: -200,
    width: 4000,
    height: 30,
  });
  expect(fitted).toMatchObject({
    x: -640,
    y: 30,
    width: 600,
    height: 300,
    minWidth: 600,
    minHeight: 300,
    maxWidth: 600,
    maxHeight: 300,
  });
  const defaults = windowGeometry('LargeInspector', { x: 0, y: 0, width: 2000, height: 1500 });
  expect(defaults).toMatchObject({ width: 1080, height: 740, maxWidth: 1600, maxHeight: 1200 });
});
it.each(['null', '{bad', '{"x":0,"y":0,"width":-2,"height":400,"generation":""}'])(
  'ignores damaged geometry %s',
  async (raw) => {
    values.set('window-placement:Inspector', raw);
    expect((await readWindowPlacement('Inspector')).placement).toBeUndefined();
  },
);
