/**
 * environment/utils/color.ts
 *
 * High-performance CSS color validation with an LRU-style cache.
 * Supports: named colors, hex (#RGB, #RRGGBB, #RRGGBBAA), rgb/rgba, hsl/hsla.
 */

const COLOR_CACHE = new Map<string, boolean>();
const CACHE_MAX_SIZE = 200;
const EVICT_COUNT = Math.floor(CACHE_MAX_SIZE * 0.2);

export function isCssColor(value: string): boolean {
  if (!value) return false;

  const cached = COLOR_CACHE.get(value);
  if (cached !== undefined) return cached;

  const c = value[0];
  let isValid = false;

  if (c === '#') {
    const len = value.length;
    isValid = (len === 4 || len === 7 || len === 9) && /^#[0-9a-fA-F]+$/.test(value);
  } else if (c === 'r') {
    isValid = /^rgba?\s*\(/.test(value);
  } else if (c === 'h') {
    isValid = /^hsla?\s*\(/.test(value);
  } else if (c >= 'a' && c <= 'z') {
    isValid = /^[a-z]+$/.test(value);
  }

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
