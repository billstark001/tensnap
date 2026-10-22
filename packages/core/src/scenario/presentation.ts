import { ProtocolValueSchema, type ProtocolData } from '@tensnap/protocol';
import { z } from 'zod';
import { GridEnvStorage } from '../environment/storages/GridEnvStorage';
import { TrajectoryStorage } from '../environment/storages/TrajectoryStorage';
import { BackgroundStorage } from '../environment/storages/BackgroundStorage';
import { DEFAULT_TRAJECTORY_CONFIG } from '../environment/utils/trajectory';
import type {
  ScenarioEnvironmentState,
  ScenarioEnvironmentSnapshot,
  ScenarioLayerState,
} from './types';

/** Renderer-local overrides. These never modify simulator declarations or restore payloads. */
export type LayerPresentationOverride = Record<string, ProtocolData>;
export type LayerPresentationOverrides = Record<string, LayerPresentationOverride>;
export const LayerPresentationOverridesSchema = z.record(
  z.string(),
  z.record(z.string(), ProtocolValueSchema),
);

export interface PresentationField {
  defaultValue: string | number | boolean;
  choices?: readonly string[];
  min?: number;
  integer?: boolean;
  color?: boolean;
}

const fields: Record<string, Record<string, PresentationField>> = {
  agent: {
    coord_offset: { defaultValue: 'int', choices: ['int', 'float'] },
    z_index: { defaultValue: 40 },
  },
  edge: {
    link_distance: { defaultValue: 4 },
    charge_strength: { defaultValue: -2 },
    centering_strength: { defaultValue: 0.1, min: 0 },
    collision_radius: { defaultValue: 2, min: 0 },
    max_component_distance: { defaultValue: 4, min: 0 },
    component_spacing: { defaultValue: 5, min: 0 },
    z_index: { defaultValue: 20 },
  },
  grid: {
    stroke_color: { defaultValue: '#808080', color: true },
    z_index: { defaultValue: 10 },
    x_origin: { defaultValue: 0 },
    y_origin: { defaultValue: 0 },
    x_unit: { defaultValue: 1, min: Number.MIN_VALUE },
    y_unit: { defaultValue: 1, min: Number.MIN_VALUE },
    x_interval: { defaultValue: 1, min: Number.MIN_VALUE },
    y_interval: { defaultValue: 1, min: Number.MIN_VALUE },
    x_ratio: { defaultValue: 10, min: 2, integer: true },
    y_ratio: { defaultValue: 10, min: 2, integer: true },
  },
  trajectory: {
    width: { defaultValue: DEFAULT_TRAJECTORY_CONFIG.width, min: Number.MIN_VALUE },
    color: { defaultValue: DEFAULT_TRAJECTORY_CONFIG.color, color: true },
    z_index: { defaultValue: 30 },
  },
  background: {
    interpolation: { defaultValue: 'nearest', choices: ['nearest', 'linear'] },
    z_index: { defaultValue: 0 },
  },
};

export function layerPresentationFields(
  layerType: string,
): Readonly<Record<string, PresentationField>> {
  return Object.prototype.hasOwnProperty.call(fields, layerType) ? fields[layerType]! : {};
}

/** Read effective simulator presentation without dumping or copying retained history. */
export function layerPresentationMetadata(layer: ScenarioLayerState): Record<string, unknown> {
  const storage = layer.storage;
  const values =
    storage instanceof GridEnvStorage
      ? storage.getData()
      : storage instanceof TrajectoryStorage
        ? storage.getData().config
        : storage instanceof BackgroundStorage
          ? storage.getData()
          : undefined;
  return values ? { ...layer.metadata, ...values } : layer.metadata;
}

export function resolvePresentationMetadata(
  layerType: string,
  metadata: Record<string, unknown>,
  overrides?: Record<string, ProtocolData>,
): Record<string, unknown> {
  if (!overrides || !Object.keys(overrides).length) return metadata;
  const definition = layerPresentationFields(layerType);
  for (const [key, value] of Object.entries(overrides)) {
    const field = Object.prototype.hasOwnProperty.call(definition, key)
      ? definition[key]
      : undefined;
    if (
      !field ||
      typeof value !== typeof field.defaultValue ||
      (typeof value === 'number' &&
        (!Number.isFinite(value) ||
          (field.integer === true && !Number.isInteger(value)) ||
          (field.min !== undefined && value < field.min))) ||
      (field.choices && !field.choices.includes(value as string))
    ) {
      throw new Error(`Invalid ${layerType} presentation override: ${key}.`);
    }
  }
  return { ...metadata, ...overrides };
}

export function presentEnvironment(
  environment: ScenarioEnvironmentState,
  overrides?: LayerPresentationOverrides,
): ScenarioEnvironmentState {
  if (!overrides || !Object.keys(overrides).length) return environment;
  for (const id of Object.keys(overrides))
    if (!environment.layers.has(id)) throw new Error(`Presentation layer does not exist: ${id}.`);
  return {
    ...environment,
    layers: new Map(
      [...environment.layers].map(([id, layer]) => [
        id,
        {
          ...layer,
          presentation: { ...layer.presentation, ...overrides[id] },
          metadata: resolvePresentationMetadata(layer.layerType, layer.metadata, overrides[id]),
        },
      ]),
    ),
  };
}

export function presentEnvironmentSnapshot(
  environment: ScenarioEnvironmentSnapshot,
  overrides?: LayerPresentationOverrides,
): ScenarioEnvironmentSnapshot {
  if (!overrides || !Object.keys(overrides).length) return environment;
  for (const id of Object.keys(overrides))
    if (!environment.layers.some((layer) => layer.id === id))
      throw new Error(`Presentation layer does not exist: ${id}.`);
  return {
    ...environment,
    layers: environment.layers.map((layer) => ({
      ...layer,
      presentation: { ...layer.presentation, ...overrides[layer.id] },
      metadata: resolvePresentationMetadata(layer.layerType, layer.metadata, overrides[layer.id]),
    })),
  };
}
