import type { ScenarioEnvironmentState } from '@tensnap/core';
import { getEnvironmentDisplayType } from '@/components/scenario/environment-adapter';

export type EnvironmentLayerGroup = {
  title: string;
  entries: Array<{ key: string; value: unknown }>;
};

export type EditableEnvironmentLayerData = {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  groups: EnvironmentLayerGroup[];
};

export type EditableEnvironmentData = {
  id: string;
  type: string;
  displayType: '2d' | 'uniform';
  layers: EditableEnvironmentLayerData[];
};

const groupEntries = (
  metadata: Record<string, unknown>,
  groups: Array<{ title: string; keys: string[] }>,
): EnvironmentLayerGroup[] => {
  const seenKeys = new Set<string>();
  const result: EnvironmentLayerGroup[] = [];

  for (const group of groups) {
    const entries = group.keys
      .filter((key) => key in metadata)
      .map((key) => {
        seenKeys.add(key);
        return { key, value: metadata[key] };
      });
    if (entries.length > 0) {
      result.push({ title: group.title, entries });
    }
  }

  const otherEntries = Object.entries(metadata)
    .filter(([key]) => !seenKeys.has(key))
    .map(([key, value]) => ({ key, value }));

  if (otherEntries.length > 0) {
    result.push({ title: 'Other Metadata', entries: otherEntries });
  }

  return result;
};

const groupLayerDependencies = (dependencyLayerIds: Record<string, string>): EnvironmentLayerGroup[] => {
  const entries = Object.entries(dependencyLayerIds).map(([key, value]) => ({ key, value }));
  return entries.length > 0 ? [{ title: 'Dependencies', entries }] : [];
};

export const groupEnvironmentLayerMetadata = (
  layerType: string,
  metadata: Record<string, unknown>,
): EnvironmentLayerGroup[] => {
  switch (layerType) {
    case 'agent':
      return groupEntries(metadata, [
        { title: 'Geometry', keys: ['width', 'height', 'coord_offset'] },
      ]);
    case 'trajectory':
      return groupEntries(metadata, [
        { title: 'Trajectory', keys: ['length', 'width', 'color'] },
      ]);
    case 'grid':
      return groupEntries(metadata, [
        { title: 'Scene Bounds', keys: ['width', 'height'] },
        { title: 'Grid Geometry', keys: ['xOrigin', 'xUnit', 'xInterval', 'xRatio', 'yOrigin', 'yUnit', 'yInterval', 'yRatio'] },
        { title: 'Grid Style', keys: ['strokeColor'] },
      ]);
    case 'edge':
      return groupEntries(metadata, [
        { title: 'Layout', keys: ['linkDistance', 'chargeStrength', 'centeringStrength', 'collisionRadius', 'maxComponentDistance', 'componentSpacing'] },
      ]);
    case 'background':
      return groupEntries(metadata, [
        { title: 'Background', keys: ['background', 'interpolation'] },
      ]);
    default:
      return groupEntries(metadata, []);
  }
};

export const getEditableEnvironmentData = (
  environments: ReadonlyMap<string, ScenarioEnvironmentState> | undefined,
  id: string,
): EditableEnvironmentData | null => {
  if (!environments) {
    return null;
  }

  const environment = environments.get(id);
  if (!environment) {
    return null;
  }

  return {
    id: environment.id,
    type: environment.type,
    displayType: getEnvironmentDisplayType(environment),
    layers: [...environment.layers.values()].map((layer) => {
      const metadata = structuredClone((layer.metadata ?? {}) as Record<string, unknown>);
      const groups = [
        ...groupEnvironmentLayerMetadata(layer.layerType, metadata),
        ...groupLayerDependencies(layer.dependencyLayerIds ?? {}),
      ];
      return {
        id: layer.id,
        layerType: layer.layerType,
        metadata,
        groups,
      };
    }),
  };
};