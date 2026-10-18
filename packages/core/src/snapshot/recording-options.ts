import type { RecordingOptions } from './types';

/** Own value data and policy descriptors; callbacks remain shared callable policies. */
export function cloneRecordingOptions(options: RecordingOptions): RecordingOptions {
  const { layerCodecImplementations, ...data } = options;
  return {
    ...structuredClone(data),
    ...(layerCodecImplementations
      ? {
          layerCodecImplementations: Object.fromEntries(
            Object.entries(layerCodecImplementations)
              .filter(([, implementation]) => implementation !== undefined)
              .map(([id, implementation]) => [id, { ...implementation }]),
          ),
        }
      : {}),
  };
}
