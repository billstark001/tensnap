/** Load command capabilities only after parsing; concurrent users share one import. */
export function createModuleOrchestrator<T extends Record<string, () => Promise<unknown>>>(
  loaders: T,
) {
  const pending = new Map<keyof T, Promise<unknown>>();
  return {
    load<K extends keyof T>(key: K): ReturnType<T[K]> {
      let module = pending.get(key);
      if (!module) {
        module = Promise.resolve().then(loaders[key]);
        pending.set(key, module);
      }
      return module as ReturnType<T[K]>;
    },
  };
}

export const cliModules = createModuleOrchestrator({
  daemon: () => import('./index'),
  recording: () => import('./runtime/recording-files'),
  frames: () => import('./runtime/frame-files'),
  nodeStore: () => import('./runtime/NodeRecordingStore'),
  persistence: () => import('@tensnap/core/persistence'),
  snapshot: () => import('@tensnap/core/snapshot'),
  query: () => import('@tensnap/core/scenario/query-schema'),
  conditions: () => import('@tensnap/core/runtime'),
  skills: () => import('./skills'),
});
