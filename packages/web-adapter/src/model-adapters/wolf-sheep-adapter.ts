import type { Action, ChartGroupMetadata, GridAgent, Parameter } from '@tensnap/core';
import { WolfSheepConfig, WolfSheepModel, World } from '../models/wolf-sheep';
import { BaseModelAdapter } from './base-adapter';

const TERRAIN_LAYER = 'terrain';
const ANIMAL_LAYER = 'animals';

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
    return ['start', 'stop', 'step', 'reset', 'start_stop'].map((id) => {
      const continuous = id === 'start' || id === 'start_stop';
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
      stop: () => {
        shouldContinue = false;
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
      start_stop: async () => {
        shouldContinue = await this.stepOnce();
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
    await this.sendEnvLayerCreate({
      env_id: 'main',
      layer_id: TERRAIN_LAYER,
      layer_type: 'grid',
      data: { width: this.worldSize.width, height: this.worldSize.height },
    });
    await this.sendEnvLayerCreate({
      env_id: 'main',
      layer_id: ANIMAL_LAYER,
      layer_type: 'grid',
      data: { width: this.worldSize.width, height: this.worldSize.height },
    });

    await this.sendAgentCreate({ env_id: 'main', layer_id: TERRAIN_LAYER, agents: this.buildTerrainAgents(true) });
    const animals = this.buildAnimalAgents();
    this.previousAnimalIds = new Set<string | number>(animals.map((a) => a.id));
    await this.sendAgentCreate({ env_id: 'main', layer_id: ANIMAL_LAYER, agents: animals });
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
        icon: 'circle' as const,
        size: s.config.size,
      })),
      ...wolves.map((w) => ({
        id: this.getAnimalId('wolf', w as unknown as object),
        x: w.position.x,
        y: w.position.y,
        heading: (w.heading * Math.PI) / 180,
        color: '#111111',
        icon: 'circle' as const,
        size: w.config.size,
      })),
    ];
  }

  private getChartUpdates(time?: number): Array<{ id: string; value: number; time?: number }> {
    return [
      { id: 'sheep_count', value: this.model.getSheepCount(), time },
      { id: 'wolf_count', value: this.model.getWolfCount(), time },
      { id: 'grass_count', value: this.model.getGrassCount(), time },
    ];
  }

  private async stepOnce(): Promise<boolean> {
    const time = this.model.getTicks();
    await this.sendMetadataUpdate({ time });

    const canContinue = this.model.go();
    const terrainUpdates = this.buildTerrainAgents(false);
    if (terrainUpdates.length > 0) {
      await this.sendAgentUpdate({
        env_id: 'main',
        layer_id: TERRAIN_LAYER,
        agents: terrainUpdates.map((a) => ({ id: a.id, x: a.x, y: a.y, color: a.color, icon: a.icon, size: a.size })),
      });
    }

    const currentAnimals = this.buildAnimalAgents();
    const currentIds = new Set<string | number>(currentAnimals.map((a) => a.id));
    const toDelete = Array.from(this.previousAnimalIds).filter((id) => !currentIds.has(id));
    const toCreate = currentAnimals.filter((a) => !this.previousAnimalIds.has(a.id));
    const toUpdate = currentAnimals.filter((a) => this.previousAnimalIds.has(a.id));

    if (toDelete.length > 0) {
      await this.sendAgentDelete({ env_id: 'main', layer_id: ANIMAL_LAYER, ids: toDelete });
    }
    if (toCreate.length > 0) {
      await this.sendAgentCreate({ env_id: 'main', layer_id: ANIMAL_LAYER, agents: toCreate });
    }
    if (toUpdate.length > 0) {
      await this.sendAgentUpdate({
        env_id: 'main',
        layer_id: ANIMAL_LAYER,
        agents: toUpdate.map((a) => ({
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
