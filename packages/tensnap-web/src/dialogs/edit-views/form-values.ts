export function parseFiniteNumberInput(value: string, fallback = 0): number {
  if (value.trim() === '' || value === '-') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
