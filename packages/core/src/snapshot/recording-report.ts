import type {
  AssetMetadataPayload,
  AssetDataPayload,
  EnvLayerCreatePayload,
  EnvLayerUpdatePayload,
  ItemCreatePayload,
  ItemUpdatePayload,
} from '@tensnap/protocol';
import type { Snapshot } from './types';

export interface RecordingReport {
  firstFrame: number;
  lastFrame: number;
  frameCount: number;
  keyframeCount: number;
  byteLength: number;
  truncated: boolean;
  missingAssets: string[];
  externalUrls: string[];
  resourcesComplete: boolean;
  legacy: boolean;
  retention?: Snapshot['metadata']['retention'];
}
function resourceReport(
  snapshot: Snapshot,
): Pick<RecordingReport, 'missingAssets' | 'externalUrls' | 'resourcesComplete'> {
  const available = new Set<string>();
  const referenced = new Set<string>();
  const external = new Set<string>();
  const referencedIds = new Set<string>();
  const announcedIds = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^(https?:|blob:|file:)/.test(value)) external.add(value);
      if (value.startsWith('asset:')) referencedIds.add(value.slice(6));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
      const record = value as Record<string, unknown>;
      if (typeof record.asset_id === 'string') referencedIds.add(record.asset_id);
      // Item data is model-owned information, not a renderer resource reference.
      for (const [key, child] of Object.entries(record)) if (key !== 'data') visit(child);
    }
  };
  for (const keyframe of [snapshot.initial, ...snapshot.keyframes]) {
    for (const asset of keyframe.scenario.assets) {
      referenced.add(asset.meta.hash);
      announcedIds.add(asset.meta.id);
      if (asset.data !== undefined) available.add(asset.meta.hash);
    }
    for (const environment of keyframe.scenario.environments)
      for (const layer of environment.layers) {
        visit(layer.metadata);
        // Background storage URLs are derived when metadata already owns its source.
        if (layer.layerType !== 'background' || layer.metadata.background === undefined)
          visit(layer.storageSnapshot);
      }
  }
  for (const frame of snapshot.frames)
    for (const message of frame.messages) {
      if (message.type === 'asset_metadata')
        for (const meta of (message.payload as AssetMetadataPayload).assets) {
          referenced.add(meta.hash);
          announcedIds.add(meta.id);
        }
      if (message.type === 'asset_data') referenced.add((message.payload as AssetDataPayload).hash);
      if (message.type === 'asset_data' && (message.payload as AssetDataPayload).data !== undefined)
        available.add((message.payload as AssetDataPayload).hash);
      if (message.type === 'env_layer_create' || message.type === 'env_layer_update')
        visit((message.payload as EnvLayerCreatePayload | EnvLayerUpdatePayload).metadata);
      if (message.type === 'item_create' || message.type === 'item_update')
        visit((message.payload as ItemCreatePayload | ItemUpdatePayload).items);
    }
  const missingAssets = [
    ...[...referenced].filter((hash) => !available.has(hash)),
    ...[...referencedIds].filter((id) => !announcedIds.has(id)).map((id) => `asset:${id}`),
  ].sort();
  return {
    missingAssets,
    externalUrls: [...external].sort(),
    resourcesComplete: missingAssets.length === 0 && external.size === 0,
  };
}

export function inspectRecording(snapshot: Snapshot, legacy = false): RecordingReport {
  return {
    firstFrame: snapshot.initial.frame,
    lastFrame: snapshot.frames[snapshot.frames.length - 1]?.index ?? snapshot.initial.frame,
    frameCount: snapshot.frames.length,
    keyframeCount: snapshot.keyframes.length,
    byteLength: snapshot.byteLength,
    truncated: snapshot.truncated,
    legacy,
    ...(snapshot.metadata.retention
      ? { retention: structuredClone(snapshot.metadata.retention) }
      : {}),
    ...resourceReport(snapshot),
  };
}
