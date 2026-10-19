import { decodeBinaryString } from '@tensnap/protocol';
import type { CapturedFrame } from './CapturedFrame';
import { ComparisonPolicySchema } from './diff/policy';
import type { ComparisonPolicy } from './diff/policy';
import { compareScenes } from './diff/scene';
import { DiffCollector } from './diff/values';
import { binaryEqual } from './diff/equality';

export { ComparisonPolicySchema } from './diff/policy';
export type { ComparisonPolicy, ComparisonStrategy } from './diff/policy';
export type { SceneChange } from './diff/types';
export { exactValueEqual } from './diff/equality';

function checkpointEqual(left: CapturedFrame, right: CapturedFrame): boolean | undefined {
  if (!left.checkpoint || !right.checkpoint) return undefined;
  const a = left.checkpoint,
    b = right.checkpoint;
  return (
    a.encoding === b.encoding &&
    binaryEqual(
      typeof a.data === 'string' ? decodeBinaryString(a.data).bytes : a.data,
      typeof b.data === 'string' ? decodeBinaryString(b.data).bytes : b.data,
    )
  );
}

export function diffCapturedFrames(
  left: CapturedFrame,
  right: CapturedFrame,
  input: ComparisonPolicy = {},
  options: { limit?: number; offset?: number } = {},
) {
  const policy = ComparisonPolicySchema.parse(input);
  const limit = options.limit ?? 1000;
  const offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error('Invalid diff page.');
  const collector = new DiffCollector(policy, limit, offset, [left.scene, right.scene]);
  compareScenes(left.scene, right.scene, policy, collector.visit);
  const identityCompatible =
    left.modelIdentity?.model_id === right.modelIdentity?.model_id &&
    left.modelIdentity?.state_schema_version === right.modelIdentity?.state_schema_version;
  const checkpointsEqual = checkpointEqual(left, right);
  const { changes, changeCount, selectedChangeCount } = collector;
  return {
    version: 1 as const,
    left: structuredClone(left.source),
    right: structuredClone(right.source),
    sceneEqual: changeCount === 0,
    selectedEqual:
      identityCompatible &&
      checkpointsEqual !== false &&
      !!left.checkpoint === !!right.checkpoint &&
      selectedChangeCount === 0,
    identityCompatible,
    checkpointEqual: checkpointsEqual,
    policy,
    changes,
    changeCount,
    selectedChangeCount,
    complete: offset === 0 && changeCount <= limit,
    ...(offset + changes.length < changeCount ? { continuation: offset + changes.length } : {}),
  };
}
