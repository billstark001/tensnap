/**
 * environment/storages/index.ts
 */
export { BaseStorage } from './BaseStorage';
export { BackgroundStorage } from './BackgroundStorage';
export type { BackgroundData, BackgroundValue, ImageInterpolation } from './BackgroundStorage';
export { GridEnvStorage } from './GridEnvStorage';
export type { GridEnvData } from './GridEnvStorage';
export { AgentStorage } from './AgentStorage';
export type { AgentRenderState, AgentStorageData, AgentStorageSnapshot } from './AgentStorage';
export { EdgeStorage } from './EdgeStorage';
export type { EdgeStorageData, EdgeStorageSnapshot } from './EdgeStorage';
export { TrajectoryStorage } from './TrajectoryStorage';
export type {
	TrajectoryDelta,
	TrajectoryEntry,
	TrajectorySnapshotItem,
	TrajectoryStorageData,
	TrajectoryStorageSnapshot,
} from './TrajectoryStorage';
