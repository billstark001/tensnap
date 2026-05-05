/**
 * scenario/utils/plan.ts
 *
 * Shared snapshot-to-render-plan conversion utilities.
 *
 * These helpers bridge the gap between protocol-level `ScenarioEnvironmentSnapshot`
 * and the runtime `RenderPlan` used by both browser and headless hosts.
 * Keeping them in `@tensnap/core` prevents duplication across host packages.
 */

import {
	AgentStorage,
	BackgroundStorage,
	EdgeStorage,
	GridEnvStorage,
	TrajectoryStorage,
} from '../../environment/storages';
import type { BackgroundData } from '../../environment/storages/BackgroundStorage';
import type { GraphEdge } from '../../environment/types';

function isBackgroundData(value: unknown): value is BackgroundData {
	if (value === null) return true;
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	if (v.kind === 'color') return typeof v.value === 'string';
	if (v.kind === 'image') {
		return (
			typeof v.url === 'string' &&
			typeof v.isBlob === 'boolean' &&
			(v.interpolation === 'nearest' || v.interpolation === 'linear')
		);
	}
	return false;
}

function isEdgeStorageSnapshot(value: unknown): value is { edges: unknown[] } {
	return typeof value === 'object' && value !== null && Array.isArray((value as { edges?: unknown[] }).edges);
}
import type {
	ScenarioEnvironmentSnapshot,
	ScenarioEnvironmentState,
	ScenarioLayerSnapshot,
	ScenarioLayerState,
} from '../types';
import { createRenderPlan, type RenderPlan } from '../render-plan';

function cloneValue<T>(value: T): T {
	if (value === null || value === undefined || typeof value !== 'object') {
		return value;
	}
	return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function mergeRecordSnapshots(...values: unknown[]): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	for (const value of values) {
		if (isRecord(value)) {
			Object.assign(merged, cloneValue(value));
		}
	}
	return merged;
}

type LayerStorage = ScenarioLayerState['storage'];

function createLayerState(layer: ScenarioLayerSnapshot): ScenarioLayerState {
	return {
		id: layer.id,
		layerType: layer.layerType,
		metadata: cloneValue(layer.metadata ?? {}),
		dependencyLayerIds: cloneValue(layer.dependencyLayerIds ?? {}),
		storage: createLayerStorage(layer),
	};
}

function createLayerStorage(layer: ScenarioLayerSnapshot): LayerStorage {
	switch (layer.layerType) {
		case 'agent': {
			const storage = new AgentStorage();
			storage.load(cloneValue(layer.storageSnapshot ?? {}));
			return storage;
		}
		case 'grid': {
			const storage = new GridEnvStorage();
			storage.setData(mergeRecordSnapshots(layer.metadata, layer.storageSnapshot));
			return storage;
		}
		case 'edge': {
			const storage = new EdgeStorage();
			storage.setEdges(collectLayerEdges(layer));
			return storage;
		}
		case 'trajectory': {
			const storage = new TrajectoryStorage();
			storage.load(cloneValue(layer.storageSnapshot ?? {}));
			return storage;
		}
		case 'background': {
			const storage = new BackgroundStorage();
			storage.setData(isBackgroundData(layer.storageSnapshot) ? cloneValue(layer.storageSnapshot) : null);
			return storage;
		}
		default: {
			const storage = new BackgroundStorage();
			storage.setData(null);
			return storage;
		}
	}
}

function collectLayerEdges(layer: ScenarioLayerSnapshot): GraphEdge[] {
	const edgesFromStorage = isEdgeStorageSnapshot(layer.storageSnapshot)
		? layer.storageSnapshot.edges.map((edge) => cloneValue(edge as GraphEdge))
		: [];
	const metadataEdges = isRecord(layer.metadata) && Array.isArray(layer.metadata.edges)
		? layer.metadata.edges.map((edge) => cloneValue(edge as GraphEdge))
		: [];
	return [...edgesFromStorage, ...metadataEdges];
}

/**
 * Build a `RenderPlan` from a `ScenarioEnvironmentSnapshot`.
 *
 * This is the canonical bridge between protocol snapshots and the rendering
 * engine. Both browser and headless hosts should use this helper (or
 * `collectRenderData`) rather than re-implementing snapshot-to-plan logic.
 */
export function createRenderPlanFromSnapshot(snapshotEnvironment: ScenarioEnvironmentSnapshot): RenderPlan {
	const environmentState: ScenarioEnvironmentState = {
		id: snapshotEnvironment.id,
		type: snapshotEnvironment.type,
		layers: new Map(),
		dependencyGraph: new Map(),
	};

	for (const layer of snapshotEnvironment.layers) {
		environmentState.layers.set(layer.id, createLayerState(layer));
	}

	return createRenderPlan(environmentState);
}
