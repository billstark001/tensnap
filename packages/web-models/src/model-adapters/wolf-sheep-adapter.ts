import type { Action, ChartGroupMetadata, GridAgent, Parameter } from '@tensnap/core';
import { WolfSheepConfig, WolfSheepModel, World } from '../models/wolf-sheep';
import { BaseModelAdapter } from './base-adapter';

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

export class WolfSheepAdapter extends BaseModelAdapter {
  private model: WolfSheepModel;
  private worldSize: { width: number; height: number };
  private animalIdMap = new WeakMap<object, string>();
  private nextSheepId = 0;
  private nextWolfId = 0;
  private previousPatchColors: string[][] = [];
  private previousAnimalIds = new Set<string | number>();

  constructor(config: WolfSheepConfig) {
    super({
      id: 'wolf-sheep',
      name: 'Wolf Sheep Predation Model',
      description: 'Predator-prey ecosystem with sheep, wolves, and renewable grass patches.',
    });
    const world: World = { width: config.gridWidth, height: config.gridHeight };
    this.worldSize = world;
    this.model = new WolfSheepModel(world, config);
  }

  protected getParameters(): Parameter[] {
    const config = this.model.getConfig();
    return [
      { id: 'modelVersion', type: 'enum', label: 'Model Version', value: config.modelVersion, options: ['sheep-wolves', 'sheep-wolves-grass'], allowRuntimeChange: false },
      { id: 'initialNumberSheep', type: 'number', label: 'Initial Sheep', value: config.initialNumberSheep, min: 0, max: 500, step: 10, allowRuntimeChange: false },
      { id: 'initialNumberWolves', type: 'number', label: 'Initial Wolves', value: config.initialNumberWolves, min: 0, max: 500, step: 10, allowRuntimeChange: false },
      { id: 'sheepGainFromFood', type: 'number', label: 'Sheep Gain From Food', value: config.sheepGainFromFood, min: 0, max: 50, step: 1, allowRuntimeChange: true },
      { id: 'wolfGainFromFood', type: 'number', label: 'Wolf Gain From Food', value: config.wolfGainFromFood, min: 0, max: 100, step: 1, allowRuntimeChange: true },
      { id: 'grassRegrowthTime', type: 'number', label: 'Grass Regrowth Time', value: config.grassRegrowthTime, min: 0, max: 100, step: 1, allowRuntimeChange: true },
      { id: 'sheepReproduce', type: 'number', label: 'Sheep Reproduce %', value: config.sheepReproduce, min: 0, max: 20, step: 1, allowRuntimeChange: true },
      { id: 'wolfReproduce', type: 'number', label: 'Wolf Reproduce %', value: config.wolfReproduce, min: 0, max: 20, step: 1, allowRuntimeChange: true },
      { id: 'showEnergy', type: 'boolean', label: 'Show Energy', value: config.showEnergy, allowRuntimeChange: true },
    ];
  }

  protected getActions(): Action[] {
    return ['start', 'step', 'reset'].map((id) => {
      const continuous = id === 'start';
      return {
        id,
        label: id.split('_').map((w) => `${w[0].toUpperCase()}${w.slice(1)}`).join('/'),
        allowRuntimeChange: true,
        continuous,
      };
    });
  }

  protected getEnvironments(): Array<{ id: string; type: 'uniform' | '2d' }> {
    return [{ id: 'main', type: '2d' }];
  }

  protected getCharts(): ChartGroupMetadata[] {
    return [
      { id: 'sheep_count', label: 'Sheep', color: '#ffffff' },
      { id: 'wolf_count', label: 'Wolves', color: '#111111' },
      { id: 'grass_count', label: 'Grass', color: '#62a862' },
    ];
  }

  protected async handleParameterChange(id: string, value: unknown): Promise<void> {
    const config = this.model.getConfig();
    if (id in config) {
      this.model.updateConfig({ [id]: value } as Partial<typeof config>);
    }
  }

  protected async handleActionStart(id: string, continuous?: boolean): Promise<void> {
    let shouldContinue = false;

    const actionMap: Record<string, () => Promise<void> | void> = {
      start: async () => {
        shouldContinue = await this.stepOnce();
      },
      step: async () => {
        await this.stepOnce();
        shouldContinue = false;
      },
      reset: async () => {
        this.model.reset();
        this.animalIdMap = new WeakMap();
        this.nextSheepId = 0;
        this.nextWolfId = 0;
        this.previousAnimalIds.clear();
        this.capturePatchSnapshot();
        await this.sendInitialData();
        await this.sendChartUpdate({ operations: [
          { id: 'sheep_count', operation: 'clear' },
          { id: 'wolf_count', operation: 'clear' },
          { id: 'grass_count', operation: 'clear' },
        ] });
        shouldContinue = false;
      },
    };
    await actionMap[id]?.();

    await this.sendActionEnd({
      id,
      continue: !!continuous && shouldContinue,
    });
  }

  protected async initialize(): Promise<void> {
    this.model.setup();
    this.capturePatchSnapshot();
  }

  protected async cleanup(): Promise<void> {
    this.model.destroy();
  }

  protected async sendInitialData(): Promise<void> {
    await this.registerAnimalAssets();

    await this.sendEnvLayerCreate({
      env_id: 'main',
      layer_id: TERRAIN_LAYER,
      layer_type: 'agent',
      data: { width: this.worldSize.width, height: this.worldSize.height },
    });
    await this.sendEnvLayerCreate({
      env_id: 'main',
      layer_id: GRID_LAYER,
      layer_type: 'grid',
      data: { width: this.worldSize.width, height: this.worldSize.height },
    });
    await this.sendEnvLayerCreate({
      env_id: 'main',
      layer_id: ANIMAL_LAYER,
      layer_type: 'agent',
      data: { width: this.worldSize.width, height: this.worldSize.height },
    });

    await this.sendItemCreate({ env_id: 'main', layer_id: TERRAIN_LAYER, items: this.buildTerrainAgents(true) });
    const animals = this.buildAnimalAgents();
    this.previousAnimalIds = new Set<string | number>(animals.map((a) => a.id));
    await this.sendItemCreate({ env_id: 'main', layer_id: ANIMAL_LAYER, items: animals });
    await this.sendMetadataUpdate({ time: 0 });
    await this.sendChartUpdate({ updates: this.getChartUpdates(0) });
  }

  private capturePatchSnapshot(): void {
    const patches = this.model.getPatches();
    this.previousPatchColors = patches.map((row) => row.map((p) => p.color));
  }

  private buildTerrainAgents(full: boolean): GridAgent[] {
    const patches = this.model.getPatches();
    const result: GridAgent[] = [];
    for (let y = 0; y < patches.length; y++) {
      for (let x = 0; x < (patches[y]?.length ?? 0); x++) {
        const color = patches[y][x].color === 'green' ? '#67b36b' : '#8a6d4b';
        if (!full && this.previousPatchColors[y]?.[x] === patches[y][x].color) {
          continue;
        }
        result.push({ id: `patch_${x}_${y}`, x, y, heading: 0, color, icon: 'square', size: 1 });
      }
    }
    return result;
  }

  private getAnimalId(kind: 'sheep' | 'wolf', obj: object): string {
    const existing = this.animalIdMap.get(obj);
    if (existing) {
      return existing;
    }
    const id = kind === 'sheep' ? `sheep_${this.nextSheepId++}` : `wolf_${this.nextWolfId++}`;
    this.animalIdMap.set(obj, id);
    return id;
  }

  private buildAnimalAgents(): GridAgent[] {
    const sheep = Array.from(this.model.getSheep()) as unknown as AnimalObj[];
    const wolves = Array.from(this.model.getWolves()) as unknown as AnimalObj[];
    return [
      ...sheep.map((s) => ({
        id: this.getAnimalId('sheep', s as unknown as object),
        x: s.position.x,
        y: s.position.y,
        heading: (s.heading * Math.PI) / 180,
        color: '#f1f1f1',
        icon: SHEEP_ICON,
        size: s.config.size,
      })),
      ...wolves.map((w) => ({
        id: this.getAnimalId('wolf', w as unknown as object),
        x: w.position.x,
        y: w.position.y,
        heading: (w.heading * Math.PI) / 180,
        color: '#111111',
        icon: WOLF_ICON,
        size: w.config.size,
      })),
    ];
  }

  private async registerAnimalAssets(): Promise<void> {
    const encoder = new TextEncoder();
    await this.registerAsset(SHEEP_ASSET_ID, 'image/svg+xml', encoder.encode(SHEEP_SVG), 'Sheep');
    await this.registerAsset(WOLF_ASSET_ID, 'image/svg+xml', encoder.encode(WOLF_SVG), 'Wolf');
  }

  private getChartUpdates(time?: number): Array<{ id: string; value: number; time?: number }> {
    return [
      { id: 'sheep_count', value: this.model.getSheepCount(), time },
      { id: 'wolf_count', value: this.model.getWolfCount(), time },
      { id: 'grass_count', value: this.model.getGrassCount(), time },
    ];
  }

  private async stepOnce(): Promise<boolean> {
    const canContinue = this.model.go();
    const time = this.model.getTicks();
    await this.sendMetadataUpdate({ time });
    const terrainUpdates = this.buildTerrainAgents(false);
    if (terrainUpdates.length > 0) {
      await this.sendItemUpdate({
        env_id: 'main',
        layer_id: TERRAIN_LAYER,
        items: terrainUpdates.map((a) => ({ id: a.id, x: a.x, y: a.y, color: a.color, icon: a.icon, size: a.size })),
      });
    }

    const currentAnimals = this.buildAnimalAgents();
    const currentIds = new Set<string | number>(currentAnimals.map((a) => a.id));
    const toDelete = Array.from(this.previousAnimalIds).filter((id) => !currentIds.has(id));
    const toCreate = currentAnimals.filter((a) => !this.previousAnimalIds.has(a.id));
    const toUpdate = currentAnimals.filter((a) => this.previousAnimalIds.has(a.id));

    if (toDelete.length > 0) {
      await this.sendItemDelete({ env_id: 'main', layer_id: ANIMAL_LAYER, items: toDelete.map((id) => ({ id })) });
    }
    if (toCreate.length > 0) {
      await this.sendItemCreate({ env_id: 'main', layer_id: ANIMAL_LAYER, items: toCreate });
    }
    if (toUpdate.length > 0) {
      await this.sendItemUpdate({
        env_id: 'main',
        layer_id: ANIMAL_LAYER,
        items: toUpdate.map((a) => ({
          id: a.id,
          x: a.x,
          y: a.y,
          heading: a.heading,
          color: a.color,
          icon: a.icon,
          size: a.size,
        })),
      });
    }
    this.previousAnimalIds = currentIds;
    await this.sendChartUpdate({ updates: this.getChartUpdates(this.model.getTicks()) });

    this.capturePatchSnapshot();

    return canContinue;
  }
}

export function createWolfSheepAdapter(config: Partial<WolfSheepConfig> = {}): WolfSheepAdapter {
  const defaults: WolfSheepConfig = {
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
  return new WolfSheepAdapter({ ...defaults, ...config });
}
