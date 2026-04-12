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
        size: 1,
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
        size: 1,
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

class Patch {
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

export interface World {
  width: number;
  height: number;
}

// Main Model Class
export class WolfSheepModel {
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
