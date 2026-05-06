/**
 * scenario/utils/plan.ts
 *
 * Shared snapshot-to-render-plan conversion utilities.
 *
 * These helpers bridge the gap between protocol-level `ScenarioEnvironmentSnapshot`
 * and the runtime `RenderPlan` used by both browser and headless hosts.
 * Keeping them in `@tensnap/core` prevents duplication across host packages.
 */

import { layerRegistry } from '../layer-registry';
import type {
	ScenarioEnvironmentSnapshot,
	ScenarioEnvironmentState,
	ScenarioLayerSnapshot,
	ScenarioLayerState,
} from '../types';
import { createRenderPlan, type RenderPlan } from '../render-plan';

// #region UnknownLayerStorage
/**
 * A minimal storage implementation for unknown/unregistered layer types.
 * This replaces the old fallback that used BackgroundStorage as a generic
 * placeholder, which violated the principle of a single source of truth
 * in the layer registry.
 */
export class UnknownLayerStorage {
	private data: Record<string, unknown> = {};

	dump(): Record<string, unknown> {
		return { ...this.data };
	}

	load(snapshot: unknown): void {
		this.data = typeof snapshot === 'object' && snapshot !== null
			? structuredClone(snapshot as Record<string, unknown>)
			: {};
	}
}
// #endregion

function cloneValue<T>(value: T): T {
	if (value === null || value === undefined || typeof value !== 'object') {
		return value;
	}
	return structuredClone(value);
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
	// Registry-based fromSnapshot is the single source of truth.
	// All five built-in types register fromSnapshot, so this path covers them.
	const fromSnapshot = layerRegistry.get(layer.layerType)?.fromSnapshot;
	if (fromSnapshot) {
		return fromSnapshot(layer);
	}

	// For unregistered/unknown layer types, use UnknownLayerStorage
	// instead of falling back to a built-in storage type. This ensures
	// the registry remains the single source of truth for layer type
	// handling, and unknown types do not silently masquerade as
	// BackgroundStorage.
	return new UnknownLayerStorage();
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