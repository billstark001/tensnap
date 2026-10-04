/** Pure deterministic host model; protocol binding lives in js.ts. */
export type Agent = { id: number; x: number; y: number; health: 'S' | 'I' | 'R' };
export type CounterSnapshot = {
  x: number;
  steps: number;
  rng: number;
  queue: number[];
  speed: number;
  agents: Agent[];
  next_id: number;
  base_population: number;
  births: number;
  deaths: number;
};

export class CounterModel {
  x = 0;
  steps = 0;
  rng = 7;
  queue = [1, 2, 3];
  speed: number;
  agents: Agent[] = [];
  next_id = 0;
  base_population = 0;
  births = 0;
  deaths = 0;

  constructor(speed = 1) {
    this.speed = speed;
    this.seed(4);
  }

  step(): void {
    this.steps += 1;
    this.x += this.speed;
    this.rng = (this.rng * 17 + 11) % 997;
    this.queue = [...this.queue.slice(1), this.queue[0]! + this.steps];
    if (this.agents.length === 0) return;
    this.agents = this.agents.map((agent) => ({
      ...agent,
      x: (agent.x + 1 + (agent.id % 3)) % 64,
      y: (agent.y + 2) % 64,
      health:
        agent.health === 'I' && this.steps % 2 === 0
          ? 'R'
          : agent.health === 'S' && agent.id % 5 === 0 && this.steps % 3 === 0
            ? 'I'
            : agent.health,
    }));
    if (this.steps % 3 === 0) {
      this.agents.shift();
      this.deaths += 1;
    }
    if (this.steps % 2 === 0) {
      this.agents.push(this.newAgent());
      this.births += 1;
    }
  }

  setSpeed(value: number): void {
    this.speed = value;
  }

  snapshot(): CounterSnapshot {
    return {
      x: this.x,
      steps: this.steps,
      rng: this.rng,
      queue: [...this.queue],
      speed: this.speed,
      agents: this.agents.map((agent) => ({ ...agent })),
      next_id: this.next_id,
      base_population: this.base_population,
      births: this.births,
      deaths: this.deaths,
    };
  }

  restore(saved: CounterSnapshot): void {
    this.x = saved.x;
    this.steps = saved.steps;
    this.rng = saved.rng;
    this.queue = [...saved.queue];
    this.speed = saved.speed;
    this.agents = saved.agents.map((agent) => ({ ...agent }));
    this.next_id = saved.next_id;
    this.base_population = saved.base_population;
    this.births = saved.births;
    this.deaths = saved.deaths;
  }

  private newAgent(): Agent {
    const id = this.next_id++;
    return { id, x: id % 64, y: Math.floor(id / 64) % 64, health: id % 4 === 1 ? 'I' : 'S' };
  }

  private seed(count: number): void {
    this.agents = [];
    this.base_population = count;
    this.births = 0;
    this.deaths = 0;
    for (let index = 0; index < count; index++) this.agents.push(this.newAgent());
  }

  seedDense(): void {
    this.seed(1024);
  }

  clearPopulation(): void {
    this.agents = [];
    this.base_population = 0;
    this.births = 0;
    this.deaths = 0;
  }

  counts(): { susceptible: number; infected: number; recovered: number } {
    return this.agents.reduce(
      (counts, agent) => {
        if (agent.health === 'S') counts.susceptible++;
        else if (agent.health === 'I') counts.infected++;
        else counts.recovered++;
        return counts;
      },
      { susceptible: 0, infected: 0, recovered: 0 },
    );
  }
}
