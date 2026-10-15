import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearColorCache, isCssColor } from './color';

beforeEach(clearColorCache);
afterEach(() => vi.unstubAllGlobals());

describe('CSS colors shared by browser and headless hosts', () => {
  it.each([
    'red',
    'Red',
    '  ReD  ',
    'transparent',
    'rebeccapurple',
    '#f00',
    '#f008',
    '#ff000080',
    'rgb(10, 20, 30)',
    'rgba(10,20,30,0.5)',
    'hsl(120, 50%, 50%)',
  ])('accepts %j without treating it as an image URL', (value) => {
    expect(isCssColor(value)).toBe(true);
    expect(isCssColor(value)).toBe(true);
  });

  it.each([
    '',
    'wallpaper',
    'image',
    'rgb(',
    'rgba(invalid)',
    'hsl()',
    '#ggg',
    'https://example.test/image.png',
  ])('rejects non-color %j', (value) => {
    expect(isCssColor(value)).toBe(false);
    expect(isCssColor(value)).toBe(false);
  });

  it('preserves browser-native color syntax beyond the portable parser', () => {
    const colors = new Set(['rgb(255 0 0 / 50%)', 'hsl(.5turn 100% 50%)', 'currentcolor']);
    const supports = vi.fn((_property: string, value: string) => colors.has(value));
    vi.stubGlobal('CSS', { supports });
    for (const color of colors) expect(isCssColor(color)).toBe(true);
    expect(isCssColor('wallpaper')).toBe(false);
    expect(isCssColor('rgb(')).toBe(false);
    expect(supports).toHaveBeenCalledWith('color', 'rgb(255 0 0 / 50%)');
  });
});
