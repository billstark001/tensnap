// Types and Interfaces
type ModelVersion = "sheep-wolves" | "sheep-wolves-grass";
type PatchColor = "green" | "brown";

interface Position {
  x: number;
  y: number;
}

interface TurtleConfig {
  shape: string;
  color: string;
  size: number;
  labelColor: string;
}

// Base Classes
abstract class Turtle {
  position: Position;
  energy: number;
  heading: number; // angle in degrees
  label: string = "";
  
  constructor(
    public config: TurtleConfig,
    public world: World
  ) {
    this.position = this.randomPosition();
    this.energy = 0;
    this.heading = Math.random() * 360;
  }

  private randomPosition(): Position {
    return {
      x: Math.random() * this.world.width,
      y: Math.random() * this.world.height
    };
  }

  move(): void {
    // Turn right by random amount up to 50 degrees
    this.heading += Math.random() * 50;
    // Turn left by random amount up to 50 degrees
    this.heading -= Math.random() * 50;
    
    // Move forward 1 step
    const radians = (this.heading * Math.PI) / 180;
    this.position.x += Math.cos(radians);
    this.position.y += Math.sin(radians);
    
    // Wrap around world boundaries
    this.position.x = ((this.position.x % this.world.width) + this.world.width) % this.world.width;
    this.position.y = ((this.position.y % this.world.height) + this.world.height) % this.world.height;
  }

  getPatchCoords(): { x: number; y: number } {
    return {
      x: Math.floor(this.position.x),
      y: Math.floor(this.position.y)
    };
  }

  death(): boolean {
    return this.energy < 0;
  }

  setLabel(text: string): void {
    this.label = text;
  }
}

class Sheep extends Turtle {
  constructor(world: World, gainFromFood: number) {
    super(
      {
        shape: "sheep",
        color: "white",
        size: 10,
        labelColor: "blue"
      },
      world
    );
    this.energy = Math.random() * (2 * gainFromFood);
  }

  eatGrass(patches: Patch[][], gainFromFood: number): void {
    const coords = this.getPatchCoords();
    const patch = patches[coords.y]?.[coords.x];
    
    if (patch && patch.color === "green") {
      patch.color = "brown";
      this.energy += gainFromFood;
    }
  }

  reproduce(reproduceRate: number): Sheep | null {
    if (Math.random() * 100 < reproduceRate) {
      this.energy = this.energy / 2;
      const offspring = new Sheep(this.world, 0);
      offspring.energy = this.energy;
      offspring.position = { ...this.position };
      offspring.heading = Math.random() * 360;
      offspring.move();
      return offspring;
    }
    return null;
  }
}

class Wolf extends Turtle {
  constructor(world: World, gainFromFood: number) {
    super(
      {
        shape: "wolf",
        color: "black",
        size: 10,
        labelColor: "red"
      },
      world
    );
    this.energy = Math.random() * (2 * gainFromFood);
  }

  eatSheep(sheep: Sheep[], gainFromFood: number): Sheep | null {
    const coords = this.getPatchCoords();
    
    // Find sheep at the same location
    const preyIndex = sheep.findIndex(s => {
      const sheepCoords = s.getPatchCoords();
      return sheepCoords.x === coords.x && sheepCoords.y === coords.y;
    });
    
    if (preyIndex !== -1) {
      const prey = sheep[preyIndex];
      this.energy += gainFromFood;
      return prey;
    }
    
    return null;
  }

  reproduce(reproduceRate: number): Wolf | null {
    if (Math.random() * 100 < reproduceRate) {
      this.energy = this.energy / 2;
      const offspring = new Wolf(this.world, 0);
      offspring.energy = this.energy;
      offspring.position = { ...this.position };
      offspring.heading = Math.random() * 360;
      offspring.move();
      return offspring;
    }
    return null;
  }
}

class Patch implements IPatch {
  color: PatchColor;
  countdown: number;

  constructor(
    public x: number,
    public y: number,
    modelVersion: ModelVersion,
    grassRegrowthTime: number
  ) {
    if (modelVersion === "sheep-wolves-grass") {
      this.color = Math.random() < 0.5 ? "green" : "brown";
      this.countdown = this.color === "green" 
        ? grassRegrowthTime 
        : Math.floor(Math.random() * grassRegrowthTime);
    } else {
      this.color = "green";
      this.countdown = 0;
    }
  }

  growGrass(grassRegrowthTime: number): void {
    if (this.color === "brown") {
      if (this.countdown <= 0) {
        this.color = "green";
        this.countdown = grassRegrowthTime;
      } else {
        this.countdown--;
      }
    }
  }
}

interface World {
  width: number;
  height: number;
}

// Main Model Class
class WolfSheepModel {
  private sheep: Sheep[] = [];
  private wolves: Wolf[] = [];
  private patches: Patch[][] = [];
  private ticks: number = 0;
  private maxSheep: number;
  
  constructor(
    private world: World,
    private config: {
      modelVersion: ModelVersion;
      initialNumberSheep: number;
      initialNumberWolves: number;
      sheepGainFromFood: number;
      wolfGainFromFood: number;
      grassRegrowthTime: number;
      sheepReproduce: number;
      wolfReproduce: number;
      showEnergy: boolean;
    }
  ) {
    this.maxSheep = 30000; // Can be adjusted based on platform
  }

  setup(): void {
    this.sheep = [];
    this.wolves = [];
    this.patches = [];
    this.ticks = 0;

    // Initialize patches
    for (let y = 0; y < this.world.height; y++) {
      this.patches[y] = [];
      for (let x = 0; x < this.world.width; x++) {
        this.patches[y][x] = new Patch(
          x,
          y,
          this.config.modelVersion,
          this.config.grassRegrowthTime
        );
      }
    }

    // Create sheep
    for (let i = 0; i < this.config.initialNumberSheep; i++) {
      this.sheep.push(new Sheep(this.world, this.config.sheepGainFromFood));
    }

    // Create wolves
    for (let i = 0; i < this.config.initialNumberWolves; i++) {
      this.wolves.push(new Wolf(this.world, this.config.wolfGainFromFood));
    }

    this.displayLabels();
  }

  go(): boolean {
    // Stop if no turtles
    if (this.sheep.length === 0 && this.wolves.length === 0) {
      return false;
    }

    // Stop if sheep have inherited the earth
    if (this.wolves.length === 0 && this.sheep.length > this.maxSheep) {
      console.log("The sheep have inherited the earth");
      return false;
    }

    // Process sheep
    const newSheep: Sheep[] = [];
    this.sheep = this.sheep.filter(sheep => {
      sheep.move();

      if (this.config.modelVersion === "sheep-wolves-grass") {
        sheep.energy -= 1;
        sheep.eatGrass(this.patches, this.config.sheepGainFromFood);
        
        if (sheep.death()) {
          return false;
        }
      }

      const offspring = sheep.reproduce(this.config.sheepReproduce);
      if (offspring) {
        newSheep.push(offspring);
      }

      return true;
    });
    this.sheep.push(...newSheep);

    // Process wolves
    const newWolves: Wolf[] = [];
    this.wolves = this.wolves.filter(wolf => {
      wolf.move();
      wolf.energy -= 1;

      const eatenSheep = wolf.eatSheep(this.sheep, this.config.wolfGainFromFood);
      if (eatenSheep) {
        this.sheep = this.sheep.filter(s => s !== eatenSheep);
      }

      if (wolf.death()) {
        return false;
      }

      const offspring = wolf.reproduce(this.config.wolfReproduce);
      if (offspring) {
        newWolves.push(offspring);
      }

      return true;
    });
    this.wolves.push(...newWolves);

    // Grow grass
    if (this.config.modelVersion === "sheep-wolves-grass") {
      for (const row of this.patches) {
        for (const patch of row) {
          patch.growGrass(this.config.grassRegrowthTime);
        }
      }
    }

    this.ticks++;
    this.displayLabels();
    
    return true;
  }

  private displayLabels(): void {
    // Clear all labels
    this.sheep.forEach(s => s.setLabel(""));
    this.wolves.forEach(w => w.setLabel(""));

    if (this.config.showEnergy) {
      this.wolves.forEach(w => w.setLabel(Math.round(w.energy).toString()));
      
      if (this.config.modelVersion === "sheep-wolves-grass") {
        this.sheep.forEach(s => s.setLabel(Math.round(s.energy).toString()));
      }
    }
  }

  getGrassCount(): number {
    if (this.config.modelVersion === "sheep-wolves-grass") {
      let count = 0;
      for (const row of this.patches) {
        for (const patch of row) {
          if (patch.color === "green") {
            count++;
          }
        }
      }
      return count;
    }
    return 0;
  }

  getSheepCount(): number {
    return this.sheep.length;
  }

  getWolfCount(): number {
    return this.wolves.length;
  }

  getTicks(): number {
    return this.ticks;
  }

  getSheep(): ReadonlyArray<Sheep> {
    return this.sheep;
  }

  getWolves(): ReadonlyArray<Wolf> {
    return this.wolves;
  }

  getPatches(): ReadonlyArray<ReadonlyArray<Patch>> {
    return this.patches;
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(updates: Partial<typeof this.config>) {
    Object.assign(this.config, updates);
  }

  reset(): void {
    this.setup();
  }

  destroy(): void {
    this.sheep = [];
    this.wolves = [];
    this.patches = [];
  }
}

// #region WebSocket Simulation

import type {
  Environment,
  GridEnvironment,
  Parameter,
  ChartGroupMetadata,
  GridAgent,
} from 'tensnap-web';

import {
  BaseSimulationManager,
  createFakeWebSocketOptions,
  FakeWebSocketOptions,
  createGrassBackgroundData,
  IPatch,
} from './common';

export interface WolfSheepConfig {
  modelVersion: ModelVersion;
  initialNumberSheep: number;
  initialNumberWolves: number;
  sheepGainFromFood: number;
  wolfGainFromFood: number;
  grassRegrowthTime: number;
  sheepReproduce: number;
  wolfReproduce: number;
  showEnergy: boolean;
  gridWidth: number;
  gridHeight: number;
}

class WolfSheepSimulationManager extends BaseSimulationManager {
  private model: WolfSheepModel;
  private isRunning: boolean = false;
  private intervalId: number | null = null;
  private grassBackground?: Uint8Array | string;
  private worldSize: { width: number; height: number };

  constructor(config: WolfSheepConfig) {
    super({
      name: 'Wolf Sheep Predation Model',
      description: 'A predator-prey ecosystem model with wolves hunting sheep in a grassland environment.',
    });

    this.worldSize = {
      width: config.gridWidth,
      height: config.gridHeight,
    };

    const world: World = {
      width: this.worldSize.width,
      height: this.worldSize.height,
    };

    this.model = new WolfSheepModel(world, config);
  }

  protected getParameters(): Parameter[] {
    const config = this.model.getConfig();

    const modelVersionParam: Parameter = {
      id: 'modelVersion',
      type: 'enum',
      label: 'Model Version',
      value: config.modelVersion,
      options: ['sheep-wolves', 'sheep-wolves-grass'],
      allowRuntimeChange: false,
    };

    const numberParams: Parameter[] = [
      { id: 'initialNumberSheep', type: 'number', label: 'Initial Sheep', value: config.initialNumberSheep, min: 0, max: 500, step: 10, allowRuntimeChange: false },
      { id: 'initialNumberWolves', type: 'number', label: 'Initial Wolves', value: config.initialNumberWolves, min: 0, max: 500, step: 10, allowRuntimeChange: false },
      { id: 'sheepGainFromFood', type: 'number', label: 'Sheep Gain From Food', value: config.sheepGainFromFood, min: 0, max: 50, step: 1, allowRuntimeChange: true },
      { id: 'wolfGainFromFood', type: 'number', label: 'Wolf Gain From Food', value: config.wolfGainFromFood, min: 0, max: 100, step: 1, allowRuntimeChange: true },
      { id: 'grassRegrowthTime', type: 'number', label: 'Grass Regrowth Time', value: config.grassRegrowthTime, min: 0, max: 100, step: 1, allowRuntimeChange: true },
      { id: 'sheepReproduce', type: 'number', label: 'Sheep Reproduce %', value: config.sheepReproduce, min: 0, max: 20, step: 1, allowRuntimeChange: true },
      { id: 'wolfReproduce', type: 'number', label: 'Wolf Reproduce %', value: config.wolfReproduce, min: 0, max: 20, step: 1, allowRuntimeChange: true },
    ];

    const booleanParam: Parameter = {
      id: 'showEnergy',
      type: 'boolean',
      label: 'Show Energy?',
      value: config.showEnergy,
      allowRuntimeChange: true,
    };

    const actionButtons: Parameter[] = ['start', 'stop', 'step', 'reset', 'start_stop'].map(id => ({
      id,
      type: 'action' as const,
      label: id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('/'),
      allowRuntimeChange: true,
    }));

    return [modelVersionParam, ...numberParams, booleanParam, ...actionButtons];
  }

  protected getEnvironments(): Environment[] {
    const sheep = Array.from(this.model.getSheep());
    const wolves = Array.from(this.model.getWolves());

    const agents: GridAgent[] = [
      ...sheep.map(s => ({
        id: `sheep_${sheep.indexOf(s)}`,
        x: s.position.x,
        y: s.position.y,
        heading: (s.heading * Math.PI) / 180,
        color: s.config.color,
        icon: 'circle' as const,
        size: s.config.size,
      })),
      ...wolves.map(w => ({
        id: `wolf_${wolves.indexOf(w)}`,
        x: w.position.x,
        y: w.position.y,
        heading: (w.heading * Math.PI) / 180,
        color: w.config.color,
        icon: 'circle' as const,
        size: w.config.size,
      })),
    ];

    const env: GridEnvironment = {
      id: 'main',
      type: 'grid',
      width: this.worldSize.width,
      height: this.worldSize.height,
      agents,
    };

    if (this.grassBackground) {
      env.background = this.grassBackground;
    }

    return [env];
  }

  protected getCharts(): ChartGroupMetadata[] {
    return [
      { id: 'sheep_count', label: 'Sheep', color: '#FFFFFF' },
      { id: 'wolf_count', label: 'Wolves', color: '#000000' },
      { id: 'grass_count', label: 'Grass', color: '#7EC850' },
    ];
  }

  protected async handleParameterChange(id: string, value: any): Promise<void> {
    const config = this.model.getConfig();
    if (id in config) {
      this.model.updateConfig({ [id]: value });
    }
  }

  protected async handleButtonClick(action: string): Promise<void> {
    const actions: { [key: string]: () => void | Promise<void> } = {
      start: () => this.start(),
      stop: () => this.stop(),
      step: () => this.step(),
      reset: async () => {
        this.stop();
        this.model.reset();
        this.updateGrassBackground();
        await this.sendChartUpdate({
          operations: [
            { id: 'sheep_count', operation: 'clear' },
            { id: 'wolf_count', operation: 'clear' },
            { id: 'grass_count', operation: 'clear' },
          ],
        });
        await this.sendInitialData();
      },
      start_stop: () => (this.isRunning ? this.stop() : this.start()),
    };
    await actions[action]?.();
  }

  protected async initialize(): Promise<void> {
    this.model.setup();
    this.updateGrassBackground();
  }

  protected async cleanup(): Promise<void> {
    this.stop();
    this.model.destroy();
  }

  private updateGrassBackground(): void {
    const config = this.model.getConfig();
    if (config.modelVersion === 'sheep-wolves-grass') {
      const patches = this.model.getPatches();
      this.grassBackground = createGrassBackgroundData(patches);
    } else {
      this.grassBackground = '#7EC850';
    }
  }

  private async step(): Promise<void> {
    const timeStep = this.model.getTicks();
    await this.sendTimeStepStart(timeStep);

    const canContinue = this.model.go();
    if (!canContinue) {
      this.stop();
    }

    // Update grass background after model step
    this.updateGrassBackground();

    // Send updates
    const env = this.getEnvironments()[0] as GridEnvironment;
    await this.sendEnvironmentUpdate({
      id: 'main',
      data: {
        type: 'grid',
        width: env.width,
        height: env.height,
        background: this.grassBackground,
      },
      agents: env.agents,
    });

    await this.sendChartUpdate({
      updates: [
        { id: 'sheep_count', value: this.model.getSheepCount() },
        { id: 'wolf_count', value: this.model.getWolfCount() },
        { id: 'grass_count', value: this.model.getGrassCount() },
      ],
    });

    await this.sendTimeStepEnd(timeStep + 1);
  }

  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = window.setInterval(() => this.step(), 50);
  }

  private stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async sendInitialData(): Promise<void> {
    const env = this.getEnvironments()[0] as GridEnvironment;
    await this.sendEnvironmentUpdate({
      id: 'main',
      data: {
        type: 'grid',
        width: env.width,
        height: env.height,
        background: this.grassBackground,
      },
      agents: env.agents,
    });

    await this.sendChartUpdate({
      updates: [
        { id: 'sheep_count', value: this.model.getSheepCount(), time: 0 },
        { id: 'wolf_count', value: this.model.getWolfCount(), time: 0 },
        { id: 'grass_count', value: this.model.getGrassCount(), time: 0 },
      ],
    });
  }

  public async onReady(
    sendFunc: (message: any) => void,
    wsManager: any
  ): Promise<void> {
    await super.onReady(sendFunc, wsManager);
    await this.sendInitialData();
  }
}

/**
 * Create a fake WebSocket simulation for the Wolf-Sheep model
 */
export function createWolfSheepSimulation(config?: Partial<WolfSheepConfig>): FakeWebSocketOptions {
  const defaultConfig: WolfSheepConfig = {
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

  const manager = new WolfSheepSimulationManager({ ...defaultConfig, ...config });
  return createFakeWebSocketOptions(manager);
}

// #endregion
