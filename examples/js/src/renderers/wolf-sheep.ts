import type { GridAgentState } from '@tensnap/core/environment';
import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineParameters,
} from '@tensnap/js/bindings';
import { WolfSheepConfig, WolfSheepModel, World } from '../models/wolf-sheep';

const GRID_LAYER = 'grid';
const TERRAIN_LAYER = 'terrain';
const ANIMAL_LAYER = 'animals';
const SHEEP_ASSET_ID = 'wolf-sheep:sheep';
const WOLF_ASSET_ID = 'wolf-sheep:wolf';
const SHEEP_ICON: `asset:${string}` = `asset:${SHEEP_ASSET_ID}`;
const WOLF_ICON: `asset:${string}` = `asset:${WOLF_ASSET_ID}`;

const SHEEP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="#f4f4f4" stroke="#3a3a3a" stroke-width="2">
    <ellipse cx="32" cy="34" rx="18" ry="13" />
    <circle cx="20" cy="28" r="7" />
    <circle cx="30" cy="24" r="7" />
    <circle cx="41" cy="26" r="7" />
    <circle cx="46" cy="36" r="7" />
    <circle cx="34" cy="42" r="7" />
    <circle cx="22" cy="40" r="7" />
  </g>
  <g fill="#2f2f2f">
    <ellipse cx="49" cy="34" rx="7" ry="6" />
    <circle cx="52" cy="32" r="1.2" fill="#f5f5f5" />
    <rect x="19" y="45" width="4" height="10" rx="2" />
    <rect x="29" y="45" width="4" height="10" rx="2" />
    <rect x="39" y="45" width="4" height="10" rx="2" />
  </g>
</svg>`;

const WOLF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="#4f5563" stroke="#1d2128" stroke-width="2">
    <path d="M8 39l8-11 5 4 7-8 12 5 8-3 8 10-7 9-11 4-13-2-9 5-8-3z" />
    <path d="M42 20l6-8 4 10z" />
    <path d="M31 21l5-9 2 10z" />
  </g>
  <g fill="#171a20">
    <circle cx="47" cy="31" r="1.5" fill="#f1f4fa" />
    <path d="M53 35l4 2-4 2z" />
    <path d="M18 46l6 0" stroke="#171a20" stroke-width="3" stroke-linecap="round" />
    <path d="M28 48l6 0" stroke="#171a20" stroke-width="3" stroke-linecap="round" />
  </g>
</svg>`;

type AnimalObj = { position: { x: number; y: number }; heading: number; config: { color: string; size: number } };

export const DEFAULT_WOLF_SHEEP_CONFIG: WolfSheepConfig = {
  modelVersion: 'sheep-wolves-grass',
  initialNumberSheep: 100,
  initialNumberWolves: 50,
  sheepGainFromFood: 4,
  wolfGainFromFood: 20,
  grassRegrowthTime: 30,
  sheepReproduce: 4,
  wolfReproduce: 5,
  showEnergy: false,
  gridWidth: 50,
  gridHeight: 50,
};

interface WolfSheepRuntime {
  model: WolfSheepModel;
  initialConfig: WolfSheepConfig;
  animalIdMap: WeakMap<object, string>;
  nextSheepId: number;
  nextWolfId: number;
  previousPatchColors: string[][];
}

function createWolfSheepParameters(config: WolfSheepConfig) {
  return defineParameters(
    { id: 'modelVersion', type: 'enum', label: 'Model Version', value: config.modelVersion, options: ['sheep-wolves', 'sheep-wolves-grass'], allowRuntimeChange: false },
    { id: 'initialNumberSheep', type: 'number', label: 'Initial Sheep', value: config.initialNumberSheep, min: 0, max: 500, step: 10, allowRuntimeChange: false },
    { id: 'initialNumberWolves', type: 'number', label: 'Initial Wolves', value: config.initialNumberWolves, min: 0, max: 500, step: 10, allowRuntimeChange: false },
    { id: 'sheepGainFromFood', type: 'number', label: 'Sheep Gain From Food', value: config.sheepGainFromFood, min: 0, max: 50, step: 1, allowRuntimeChange: true },
    { id: 'wolfGainFromFood', type: 'number', label: 'Wolf Gain From Food', value: config.wolfGainFromFood, min: 0, max: 100, step: 1, allowRuntimeChange: true },
    { id: 'grassRegrowthTime', type: 'number', label: 'Grass Regrowth Time', value: config.grassRegrowthTime, min: 0, max: 100, step: 1, allowRuntimeChange: true },
    { id: 'sheepReproduce', type: 'number', label: 'Sheep Reproduce %', value: config.sheepReproduce, min: 0, max: 20, step: 1, allowRuntimeChange: true },
    { id: 'wolfReproduce', type: 'number', label: 'Wolf Reproduce %', value: config.wolfReproduce, min: 0, max: 20, step: 1, allowRuntimeChange: true },
    { id: 'showEnergy', type: 'boolean', label: 'Show Energy', value: config.showEnergy, allowRuntimeChange: true },
  );
}

const WOLF_SHEEP_CHARTS = defineCharts(
  { id: 'sheep_count', label: 'Sheep', color: '#ffffff' },
  { id: 'wolf_count', label: 'Wolves', color: '#111111' },
  { id: 'grass_count', label: 'Grass', color: '#62a862' },
);

function getEffectiveConfig(runtime: WolfSheepRuntime): WolfSheepConfig {
  return {
    ...runtime.initialConfig,
    ...runtime.model.getConfig(),
  };
}

function capturePatchSnapshot(runtime: WolfSheepRuntime): void {
  const patches = runtime.model.getPatches();
  runtime.previousPatchColors = patches.map((row) => row.map((patch) => patch.color));
}

function buildTerrainAgents(runtime: WolfSheepRuntime, full: boolean): GridAgentState[] {
  const patches = runtime.model.getPatches();
  const result: GridAgentState[] = [];

  for (let y = 0; y < patches.length; y++) {
    for (let x = 0; x < (patches[y]?.length ?? 0); x++) {
      const color = patches[y][x].color === 'green' ? '#67b36b' : '#8a6d4b';
      if (!full && runtime.previousPatchColors[y]?.[x] === patches[y][x].color) {
        continue;
      }
      result.push({
        id: `patch_${x}_${y}`,
        x,
        y,
        heading: 0,
        color,
        icon: 'square',
        size: 1,
      });
    }
  }

  return result;
}

function getAnimalId(runtime: WolfSheepRuntime, kind: 'sheep' | 'wolf', obj: object): string {
  const existing = runtime.animalIdMap.get(obj);
  if (existing) {
    return existing;
  }

  const id = kind === 'sheep'
    ? `sheep_${runtime.nextSheepId++}`
    : `wolf_${runtime.nextWolfId++}`;
  runtime.animalIdMap.set(obj, id);
  return id;
}

function buildAnimalAgents(runtime: WolfSheepRuntime): GridAgentState[] {
  const sheep = Array.from(runtime.model.getSheep()) as unknown as AnimalObj[];
  const wolves = Array.from(runtime.model.getWolves()) as unknown as AnimalObj[];

  return [
    ...sheep.map((animal) => ({
      id: getAnimalId(runtime, 'sheep', animal as unknown as object),
      x: animal.position.x,
      y: animal.position.y,
      heading: (animal.heading * Math.PI) / 180,
      color: '#f1f1f1',
      icon: SHEEP_ICON,
      size: animal.config.size,
    })),
    ...wolves.map((animal) => ({
      id: getAnimalId(runtime, 'wolf', animal as unknown as object),
      x: animal.position.x,
      y: animal.position.y,
      heading: (animal.heading * Math.PI) / 180,
      color: '#111111',
      icon: WOLF_ICON,
      size: animal.config.size,
    })),
  ];
}

async function registerAnimalAssets(
  ctx: {
    publishAsset(
      id: string,
      mime: string,
      data: Uint8Array,
      label?: string,
    ): Promise<{ id: string; hash: string }>;
  },
): Promise<void> {
  const encoder = new TextEncoder();
  await ctx.publishAsset(SHEEP_ASSET_ID, 'image/svg+xml', encoder.encode(SHEEP_SVG), 'Sheep');
  await ctx.publishAsset(WOLF_ASSET_ID, 'image/svg+xml', encoder.encode(WOLF_SVG), 'Wolf');
}

export const WOLF_SHEEP_EXAMPLE = defineExample({
  id: 'wolf-sheep',
  name: 'Wolf Sheep Predation Model',
  description: 'Predator-prey ecosystem with sheep, wolves, and renewable grass patches.',
}, {
  defaults: DEFAULT_WOLF_SHEEP_CONFIG,
  parameters: createWolfSheepParameters,
  environments(config) {
    return [
      defineEnvironment({
        id: 'main',
        type: '2d',
        layers: [
          defineLayer({
            layerId: TERRAIN_LAYER,
            layerType: 'agent',
            data: { width: config.gridWidth, height: config.gridHeight },
          }),
          defineLayer({
            layerId: GRID_LAYER,
            layerType: 'grid',
            data: { width: config.gridWidth, height: config.gridHeight },
          }),
          defineLayer({
            layerId: ANIMAL_LAYER,
            layerType: 'agent',
            data: { width: config.gridWidth, height: config.gridHeight },
          }),
        ],
      }),
    ];
  },
  charts: WOLF_SHEEP_CHARTS,
  create(config) {
    const world: World = {
      width: config.gridWidth,
      height: config.gridHeight,
    };

    return {
      model: new WolfSheepModel(world, config),
      initialConfig: config,
      animalIdMap: new WeakMap<object, string>(),
      nextSheepId: 0,
      nextWolfId: 0,
      previousPatchColors: [],
    } satisfies WolfSheepRuntime;
  },
  getConfig(runtime) {
    return getEffectiveConfig(runtime);
  },
  init(runtime) {
    runtime.model.setup();
    capturePatchSnapshot(runtime);
  },
  dispose(runtime, ctx) {
    runtime.model.destroy();
    ctx.clearPublishedAssets();
  },
  async sync(runtime, ctx) {
    await registerAnimalAssets(ctx);
    await ctx.createItems('main', TERRAIN_LAYER, buildTerrainAgents(runtime, true));
    await ctx.syncItems('main', ANIMAL_LAYER, buildAnimalAgents(runtime));
    await ctx.setTime(0);
    await ctx.setChartValues({
      sheep_count: runtime.model.getSheepCount(),
      wolf_count: runtime.model.getWolfCount(),
      grass_count: runtime.model.getGrassCount(),
    }, 0);
  },
  async onParameterChange(runtime, payload, ctx) {
    const currentConfig = runtime.model.getConfig();
    if (!Object.prototype.hasOwnProperty.call(currentConfig, payload.id)) {
      return;
    }

    runtime.model.updateConfig({ [payload.id]: payload.value } as Partial<typeof currentConfig>);

    const nextValue = runtime.model.getConfig()[payload.id as keyof typeof currentConfig];
    if (!Object.is(nextValue, payload.value)) {
      await ctx.refreshParameters(payload.id);
    }
  },
  async step(runtime, ctx) {
    const canContinue = runtime.model.go();
    const time = runtime.model.getTicks();

    await ctx.setTime(time);

    const terrainUpdates = buildTerrainAgents(runtime, false);
    await ctx.updateItems(
      'main',
      TERRAIN_LAYER,
      terrainUpdates.map((agent) => ({
        id: agent.id,
        x: agent.x,
        y: agent.y,
        color: agent.color,
        icon: agent.icon,
        size: agent.size,
      })),
    );

    await ctx.syncItems('main', ANIMAL_LAYER, buildAnimalAgents(runtime));
    await ctx.setChartValues({
      sheep_count: runtime.model.getSheepCount(),
      wolf_count: runtime.model.getWolfCount(),
      grass_count: runtime.model.getGrassCount(),
    }, time);
    capturePatchSnapshot(runtime);
    return canContinue;
  },
  async reset(runtime, ctx) {
    runtime.model.reset();
    runtime.animalIdMap = new WeakMap();
    runtime.nextSheepId = 0;
    runtime.nextWolfId = 0;
    capturePatchSnapshot(runtime);
    await ctx.sync();
    await ctx.clearCharts('sheep_count', 'wolf_count', 'grass_count');
  },
});