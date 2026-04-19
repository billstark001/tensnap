export const RESERVED_SCENE_ACTION_IDS = Object.freeze({
  start: 'start',
  step: 'step',
  reset: 'reset',
});

export type SceneReservedAction = keyof typeof RESERVED_SCENE_ACTION_IDS;

const RESERVED_SCENE_ACTION_SET = new Set<string>(Object.values(RESERVED_SCENE_ACTION_IDS));

export function getReservedSceneActionId(alias: SceneReservedAction): string {
  return RESERVED_SCENE_ACTION_IDS[alias];
}

export function getReservedSceneActionAlias(id: string): SceneReservedAction | undefined {
  const aliases = Object.entries(RESERVED_SCENE_ACTION_IDS) as Array<[SceneReservedAction, string]>;
  return aliases.find(([, value]) => value === id)?.[0];
}

export function isReservedSceneActionId(id: string): boolean {
  return RESERVED_SCENE_ACTION_SET.has(id);
}