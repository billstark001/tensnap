/**
 * environment/utils/color.ts
 *
 * CSS color validation with a bounded, batched FIFO cache.
 * Uses d3-color for portable named/hex/RGB/HSL colors. Browser hosts also
 * recognize their native CSS syntax, including modern space-separated colors
 * and contextual keywords, without treating them as image URLs.
 */

import { color as parseColor } from 'd3-color';

const COLOR_CACHE = new Map<string, boolean>();
const CACHE_MAX_SIZE = 200;
const EVICT_COUNT = Math.floor(CACHE_MAX_SIZE * 0.2);

export function isCssColor(value: string): boolean {
  if (!value) return false;

  const cached = COLOR_CACHE.get(value);
  if (cached !== undefined) return cached;

  const isValid =
    parseColor(value) !== null ||
    (typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('color', value));

  if (COLOR_CACHE.size >= CACHE_MAX_SIZE) {
    const iter = COLOR_CACHE.keys();
    for (let i = 0; i < EVICT_COUNT; i++) {
      const key = iter.next().value;
      if (key !== undefined) COLOR_CACHE.delete(key);
    }
  }
  COLOR_CACHE.set(value, isValid);
  return isValid;
}

export function clearColorCache(): void {
  COLOR_CACHE.clear();
}
