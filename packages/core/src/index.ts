/**
 * @tensnap/core
 * Core scenario, runtime, and rendering primitives for TenSnap.
 */

export { AssetStore } from './asset';
export type { AssetSnapshot, ResolvedAsset, AssetStoreListener } from './asset';

export { ChartStorage } from './chart';
export type {
	ChartConfig,
	ChartDataPoint,
	ChartGroup,
	LineConfig,
} from './chart';

export {
	AgentLayer,
	AgentStorage,
	BackgroundLayer,
	BackgroundStorage,
	BaseEnvironmentView,
	BaseLayer,
	BaseStorage,
	EdgeLayer,
	EdgeStorage,
	GridEnvStorage,
	GridLayer,
	TrajectoryLayer,
	TrajectoryStorage,
} from './environment';
export type {
	Agent,
	AgentIcon,
	AgentId,
	AgentLayerConfig,
	AssetAgentIcon,
	BuiltinAgentIcon,
	GlobalTrajectoryConfig,
	GraphEdge,
	GraphEnvConfig,
	GridCoordOffset,
	GridEnvConfig,
	EnvironmentViewFitMode,
	EnvironmentViewType,
	IResizableLayer,
	TrajectoryConfig,
	TrajectoryAgentDeletePolicy,
	TrajectoryLifecycle,
	TrajectoryLayerConfig,
	TrajectoryResetPolicy,
	TrajectoryStateSyncPolicy,
	TrajectoryPoint,
} from './environment';

export * from './parameter';
export * from './runtime';
export {
	SnapshotRecorder,
	SnapshotPlayer,
	createSingleSnapshot,
	materializeSnapshot,
	snapshotFrameAt,
} from './snapshot';
export type {
	Keyframe,
	Snapshot,
	SnapshotFrame,
	SnapshotLayerCodec,
	SnapshotMetadata,
	SnapshotSeries,
} from './snapshot';

export { Scenario } from './scenario';
export type {
	AgentInspection,
	AgentInspectionBase,
	AgentInspectionOptions,
	AgentRef,
	GraphAgentInspection,
	LiveAgentInspection,
	LiveGraphAgentInspection,
	LiveSpatialAgentInspection,
	NonSpatialAgentInspection,
	ScenarioEnvironmentSnapshot,
	ScenarioEnvironmentState,
	ScenarioDumpOptions,
	ScenarioEventDetailMap,
	ScenarioEventType,
	ScenarioLayerSnapshot,
	ScenarioLayerState,
	ScenarioMessageFactory,
	ScenarioOptions,
	ScenarioSnapshot,
	SpatialAgentInspection,
} from './scenario';
export { ScenarioInspector } from './scenario';

export * from './transport';
