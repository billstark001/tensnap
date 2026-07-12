import type { GridAgentState } from '@tensnap/core/environment';
import {
  assetIcon,
  booleanField,
  enumField,
  modelBuilder,
  numberField,
} from '@tensnap/js/bindings';
import { WolfSheepConfig, WolfSheepModel, World } from '../models/wolf-sheep';

const GRID_LAYER = 'grid';
const TERRAIN_LAYER = 'terrain';
const ANIMAL_LAYER = 'animals';
const SHEEP_ASSET_ID = 'wolf-sheep:sheep';
const WOLF_ASSET_ID = 'wolf-sheep:wolf';
const SHEEP_ASSET_URL = new URL('../../../../assets/sheep.svg', import.meta.url);
const WOLF_ASSET_URL = new URL('../../../../assets/wolf.svg', import.meta.url);

async function loadTextAsset(url: URL): Promise<string> {
  if (url.protocol === 'file:') {
    const nodeFileSystem = 'node:fs/promises';
    const { readFile } = await import(/* @vite-ignore */ nodeFileSystem);
    return readFile(url, 'utf8');
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load asset ${url.href}: ${response.status}`);
  }
  return response.text();
}

type AnimalObj = { position: { x: number; y: number }; heading: number; config: { size: number } };

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

function buildTerrainUpdates(runtime: WolfSheepRuntime): GridAgentState[] {
  const updates = buildTerrainAgents(runtime, false);
  capturePatchSnapshot(runtime);
  return updates;
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
      icon: assetIcon(SHEEP_ASSET_ID),
      size: animal.config.size,
    })),
    ...wolves.map((animal) => ({
      id: getAnimalId(runtime, 'wolf', animal as unknown as object),
      x: animal.position.x,
      y: animal.position.y,
      heading: (animal.heading * Math.PI) / 180,
      color: '#111111',
      icon: assetIcon(WOLF_ASSET_ID),
      size: animal.config.size,
    })),
  ];
}

const builder = modelBuilder({
  id: 'wolf-sheep',
  name: 'Wolf Sheep Predation Model',
  description: 'Predator-prey ecosystem with sheep, wolves, and renewable grass patches.',
}, {
  defaults: DEFAULT_WOLF_SHEEP_CONFIG,
  create(config): WolfSheepRuntime {
    const world: World = {
      width: config.gridWidth,
      height: config.gridHeight,
    };

    return {
      model: new WolfSheepModel(world, config),
      initialConfig: { ...config },
      animalIdMap: new WeakMap<object, string>(),
      nextSheepId: 0,
      nextWolfId: 0,
      previousPatchColors: [],
    };
  },
  getConfig(runtime) {
    return getEffectiveConfig(runtime);
  },
  init(runtime) {
    runtime.model.setup();
    runtime.animalIdMap = new WeakMap();
    runtime.nextSheepId = 0;
    runtime.nextWolfId = 0;
    capturePatchSnapshot(runtime);
  },
  dispose(runtime) {
    runtime.model.destroy();
  },
  step(runtime) {
    return runtime.model.go();
  },
  reset(runtime) {
    runtime.model.reset();
    runtime.animalIdMap = new WeakMap();
    runtime.nextSheepId = 0;
    runtime.nextWolfId = 0;
    capturePatchSnapshot(runtime);
  },
  time(runtime) {
    return runtime.model.getTicks();
  },
});

builder
  .asset(SHEEP_ASSET_ID, {
    mime: 'image/svg+xml',
    label: 'Sheep',
    data: () => loadTextAsset(SHEEP_ASSET_URL),
  })
  .asset(WOLF_ASSET_ID, {
    mime: 'image/svg+xml',
    label: 'Wolf',
    data: () => loadTextAsset(WOLF_ASSET_URL),
  });

builder.paramsFromConfig<WolfSheepConfig>({
  get: (runtime) => getEffectiveConfig(runtime),
  set(runtime, patch) {
    runtime.model.updateConfig(patch as Partial<ReturnType<WolfSheepModel['getConfig']>>);
  },
  fields: {
    modelVersion: enumField({
      label: 'Model Version',
      options: ['sheep-wolves', 'sheep-wolves-grass'],
      runtime: false,
    }),
    initialNumberSheep: numberField({ label: 'Initial Sheep', integer: true, runtime: false }),
    initialNumberWolves: numberField({ label: 'Initial Wolves', integer: true, runtime: false }),
    sheepGainFromFood: numberField({ label: 'Sheep Gain From Food', min: 0, integer: true }),
    wolfGainFromFood: numberField({ label: 'Wolf Gain From Food', min: 0, integer: true }),
    grassRegrowthTime: numberField({ label: 'Grass Regrowth Time', min: 0, integer: true }),
    sheepReproduce: numberField({ label: 'Sheep Reproduce %', min: 0, max: 20, integer: true }),
    wolfReproduce: numberField({ label: 'Wolf Reproduce %', min: 0, max: 20, integer: true }),
    showEnergy: booleanField({ label: 'Show Energy' }),
  },
});

builder.env('main')
  .agentLayer(TERRAIN_LAYER, {
    data: (runtime) => {
      const config = getEffectiveConfig(runtime);
      return { width: config.gridWidth, height: config.gridHeight };
    },
    items: (runtime) => buildTerrainAgents(runtime, true),
    updates: (runtime) => buildTerrainUpdates(runtime),
  })
  .gridLayer(GRID_LAYER, {
    data: (runtime) => {
      const config = getEffectiveConfig(runtime);
      return { width: config.gridWidth, height: config.gridHeight };
    },
  })
  .agentLayer(ANIMAL_LAYER, {
    data: (runtime) => {
      const config = getEffectiveConfig(runtime);
      return { width: config.gridWidth, height: config.gridHeight };
    },
    items: (runtime) => buildAnimalAgents(runtime),
  });

builder
  .chart('sheep_count', {
    label: 'Sheep',
    color: '#ffffff',
    get: (runtime) => runtime.model.getSheepCount(),
  })
  .chart('wolf_count', {
    label: 'Wolves',
    color: '#111111',
    get: (runtime) => runtime.model.getWolfCount(),
  })
  .chart('grass_count', {
    label: 'Grass',
    color: '#62a862',
    get: (runtime) => runtime.model.getGrassCount(),
  });

export const WOLF_SHEEP_EXAMPLE = builder.build();
