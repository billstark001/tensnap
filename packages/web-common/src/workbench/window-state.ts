import { getSettingsPersistence } from '../settings-persistence';
/** Shared logical-pixel geometry for browser and native window hosts. */
export interface WindowPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type WindowArea = WindowPlacement;
export interface WindowDimensions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}
const policies = new Map<string, WindowDimensions>();
export function registerWindowType(type: string, dimensions?: WindowDimensions): void {
  if (dimensions) policies.set(type, dimensions);
}
const prefix = 'window-placement:';
const generationKey = `${prefix}generation`;
export function windowGeometry(
  type: string,
  area: WindowArea,
  saved?: WindowPlacement,
  size = 'md',
) {
  const policy = policies.get(type);
  const [width, height, minWidth, minHeight] =
    (policy ? [policy.width, policy.height, policy.minWidth, policy.minHeight] : undefined) ??
    (size === 'full'
      ? [area.width, area.height, 320, 240]
      : size === 'xl'
        ? [1060, 700, 600, 360]
        : size === 'lg'
          ? [680, 560, 400, 280]
          : [480, 360, 320, 200]);
  const maxWidth = Math.max(1, Math.min(1600, area.width));
  const maxHeight = Math.max(1, Math.min(1200, area.height));
  const limits = {
    minWidth: Math.min(minWidth, maxWidth),
    minHeight: Math.min(minHeight, maxHeight),
    maxWidth,
    maxHeight,
  };
  const w = Math.max(limits.minWidth, Math.min(saved?.width ?? width, maxWidth));
  const h = Math.max(limits.minHeight, Math.min(saved?.height ?? height, maxHeight));
  return {
    ...limits,
    width: w,
    height: h,
    x: Math.max(
      area.x,
      Math.min(saved?.x ?? area.x + (area.width - w) / 2, area.x + area.width - w),
    ),
    y: Math.max(
      area.y,
      Math.min(saved?.y ?? area.y + (area.height - h) / 2, area.y + area.height - h),
    ),
  };
}
export async function readWindowPlacement(type: string) {
  const storage = getSettingsPersistence();
  const generation = (await storage.get(generationKey)) ?? '';
  const raw = await storage.get(prefix + type);
  if (raw) {
    try {
      const value = JSON.parse(raw);
      if (
        value.generation === generation &&
        ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key])) &&
        value.width > 0 &&
        value.height > 0
      )
        return { generation, placement: value as WindowPlacement };
    } catch {
      /* A damaged preference must not prevent opening a window. */
    }
  }
  return { generation, placement: undefined };
}
export async function saveWindowPlacement(
  type: string,
  generation: string,
  placement: WindowPlacement,
): Promise<void> {
  const storage = getSettingsPersistence();
  if (((await storage.get(generationKey)) ?? '') !== generation) return;
  await storage.set(prefix + type, JSON.stringify({ ...placement, generation }));
}
/** Existing open windows cannot repopulate memories cleared by this action. */
export async function clearWindowPlacements(): Promise<void> {
  const storage = getSettingsPersistence();
  await storage.set(generationKey, crypto.randomUUID());
  const keys = await storage.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(prefix) && key !== generationKey)
      .map((key) => storage.remove(key)),
  );
}
