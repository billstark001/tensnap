/**
 * Schelling Segregation Model
 * 
 * A classic agent-based model demonstrating how individual preferences
 * for similar neighbors can lead to large-scale segregation patterns.
 * 
 * Based on Thomas Schelling's work on racial segregation (1969, 1971).
 */

import type { GridAgentState } from '@tensnap/core/environment';
import type { ProtocolValue } from '@tensnap/protocol';

interface SimpleGridEnv {
  id: string;
  type: 'grid';
  width: number;
  height: number;
  agents: GridAgentState[];
}

export interface SchellingConfig {
  agentSize?: number;
  agentSizeUnsatisfied?: number;
  gridWidth: number;
  gridHeight: number;
  similarityThreshold: number;
  density: number;
  balance: number;
  /** Optional deterministic seed for reproducible runs. It is not a UI parameter. */
  seed?: number;
}

interface Agent {
  id: string;
  x: number;
  y: number;
  type: 1 | 2;
  satisfied: boolean;
}

type AgentChange = {
  position?: true;
  appearance?: true;
};

export type SchellingAgentUpdate = Pick<GridAgentState, 'id'> & Partial<Pick<GridAgentState, 'x' | 'y' | 'size'>>;

export class SchellingModel {
  private config: Required<Omit<SchellingConfig, 'seed'>>;
  private readonly seed: number | undefined;
  private random: () => number = Math.random;
  private agents: Agent[] = [];
  private agentChanges = new Map<Agent, AgentChange>();

  /**
   * Flat 1D grid: index = y * gridWidth + x.
   * Eliminates the outer-array pointer dereference of a 2D layout.
   */
  private grid: (Agent | null)[] = [];

  /**
   * Empty-spots pool: O(1) random sampling, O(1) add/remove.
   * Deletion uses swap-and-pop backed by an index map.
   */
  private emptySpots: number[] = [];
  private emptySpotIndexMap: Map<number, number> = new Map();

  /** Incremental tracking avoids O(N) filter on every step. */
  private unsatisfiedSet: Set<Agent> = new Set();

  private timeStep: number = 0;
  private isRunning: boolean = false;
  private intervalId: number | null = null;
  private readonly eventHandlers: { [event: string]: Function[] } = {};
  private satisfiedCount: number = 0;
  private segregationIndex: number = 0;

  private static readonly AGENT_TYPES = [
    { type: 1, color: '#3498db', prefix: 'agent1' },
    { type: 2, color: '#e74c3c', prefix: 'agent2' },
  ] as const;

  constructor(config: SchellingConfig) {
    const { seed, ...modelConfig } = config;
    this.seed = SchellingModel.normalizeSeed(seed);
    this.config = {
      agentSize: 1,
      agentSizeUnsatisfied: (config.agentSize ?? 1) * 0.6,
      ...modelConfig,
      gridWidth: Math.max(1, Math.floor(modelConfig.gridWidth)),
      gridHeight: Math.max(1, Math.floor(modelConfig.gridHeight)),
      similarityThreshold: SchellingModel.clamp01(modelConfig.similarityThreshold),
      density: SchellingModel.clamp01(modelConfig.density),
      balance: SchellingModel.clamp01(modelConfig.balance),
    };
  }

  private static clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  private static normalizeSeed(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) >>> 0 : undefined;
  }

  /** Mulberry32 keeps benchmark seeds local instead of changing global Math.random. */
  private static randomForSeed(seed: number | undefined): () => number {
    if (seed === undefined) return Math.random;
    let state = seed;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  // ── Event handling ──────────────────────────────────────────────────────────

  on(event: string, handler: Function) {
    (this.eventHandlers[event] ??= []).push(handler);
  }

  off(event: string, handler: Function) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
  }

  private emit(event: string, ...args: any[]) {
    this.eventHandlers[event]?.forEach(handler => handler(...args));
  }

  // ── Empty-spots pool ────────────────────────────────────────────────────────

  /** O(1) insertion. */
  private addEmptySpot(enc: number): void {
    this.emptySpotIndexMap.set(enc, this.emptySpots.length);
    this.emptySpots.push(enc);
  }

  /** O(1) removal via swap-and-pop. */
  private removeEmptySpot(enc: number): void {
    const idx = this.emptySpotIndexMap.get(enc)!;
    const last = this.emptySpots[this.emptySpots.length - 1];
    this.emptySpots[idx] = last;
    this.emptySpotIndexMap.set(last, idx);
    this.emptySpots.pop();
    this.emptySpotIndexMap.delete(enc);
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  initialize() {
    this.random = SchellingModel.randomForSeed(this.seed);
    this.agents = [];
    this.agentChanges.clear();
    this.unsatisfiedSet = new Set();
    this.timeStep = 0;
    this.satisfiedCount = 0;
    this.segregationIndex = 0;

    const { gridWidth: W, gridHeight: H } = this.config;
    const size = W * H;
    this.grid = new Array(size).fill(null);

    // Pre-fill the pool with every encoded position
    this.emptySpots = Array.from({ length: size }, (_, i) => i);
    this.emptySpotIndexMap = new Map(this.emptySpots.map((enc, i) => [enc, i]));

    const { density, balance } = this.config;
    const type1Threshold = density * balance;
    let nextType1 = 0;
    let nextType2 = 0;

    for (let enc = 0; enc < size; enc++) {
      const value = this.random();
      if (value >= density) {
        continue;
      }

      const isType1 = value < type1Threshold;
      const agent: Agent = {
        id: isType1 ? `agent1_${nextType1++}` : `agent2_${nextType2++}`,
        x: enc % W,
        y: (enc / W) | 0,
        type: isType1 ? 1 : 2,
        satisfied: false,
      };
      this.grid[enc] = agent;
      this.removeEmptySpot(enc);
      this.agents.push(agent);
    }

    this.updateAllSatisfaction();
    this.agentChanges.clear();
  }

  // ── Neighbour analysis ──────────────────────────────────────────────────────

  /**
   * Inlined Moore-neighbourhood similarity ratio.
   * No intermediate Agent[] allocation; row offset hoisted out of inner loop;
   * self-skip via `(dx | dy) === 0` (true only when both are 0).
   */
  private calculateSimilarityRatio(agent: Agent, x = agent.x, y = agent.y): number {
    const { gridWidth: W, gridHeight: H } = this.config;
    const grid = this.grid;
    const t = agent.type;
    let total = 0, similar = 0;

    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const rowOff = ny * W;
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx | dy) === 0) continue;
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const n = grid[rowOff + nx];
        if (n !== null) { total++; if (n.type === t) similar++; }
      }
    }

    return total === 0 ? 1 : similar / total;
  }

  private calculateSatisfaction(agent: Agent): boolean {
    return this.calculateSimilarityRatio(agent) >= this.config.similarityThreshold;
  }

  // ── Satisfaction tracking ───────────────────────────────────────────────────

  /** Full O(N) rebuild — only at initialization or similarity-threshold change. */
  private updateAllSatisfaction(trackChanges = false): void {
    this.satisfiedCount = 0;
    this.unsatisfiedSet.clear();
    for (const agent of this.agents) {
      const previous = agent.satisfied;
      agent.satisfied = this.calculateSatisfaction(agent);
      if (trackChanges && previous !== agent.satisfied) this.markAgentChanged(agent, 'appearance');
      if (agent.satisfied) {
        this.satisfiedCount++;
      } else {
        this.unsatisfiedSet.add(agent);
      }
    }
  }

  private markAgentChanged(agent: Agent, change: keyof AgentChange): void {
    const changes = this.agentChanges.get(agent) ?? {};
    changes[change] = true;
    this.agentChanges.set(agent, changes);
  }

  /**
   * Incremental O(9) update after a move.
   * Recalculates satisfaction for every occupant in the 3×3 neighbourhood of
   * (x, y) and keeps satisfiedCount / unsatisfiedSet in sync.
   */
  private updateSatisfactionAt(x: number, y: number): void {
    const { gridWidth: W, gridHeight: H, similarityThreshold: thresh } = this.config;
    const grid = this.grid;

    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const rowOff = ny * W;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const agent = grid[rowOff + nx];
        if (agent === null) continue;

        const nowSatisfied = this.calculateSimilarityRatio(agent) >= thresh;
        if (agent.satisfied !== nowSatisfied) {
          agent.satisfied = nowSatisfied;
          this.markAgentChanged(agent, 'appearance');
          if (nowSatisfied) {
            this.satisfiedCount++;
            this.unsatisfiedSet.delete(agent);
          } else {
            this.satisfiedCount--;
            this.unsatisfiedSet.add(agent);
          }
        }
      }
    }
  }

  private calculateSegregationIndex(): number {
    const { gridWidth: W, gridHeight: H } = this.config;
    const grid = this.grid;
    let totalSimilarity = 0, count = 0;

    for (const { x, y, type } of this.agents) {
      let total = 0, similar = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        const rowOff = ny * W;
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx | dy) === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const n = grid[rowOff + nx];
          if (n !== null) { total++; if (n.type === type) similar++; }
        }
      }
      if (total > 0) { totalSimilarity += similar / total; count++; }
    }

    return count > 0 ? totalSimilarity / count : 0;
  }

  // ── Agent movement ──────────────────────────────────────────────────────────

  private moveAgentTo(agent: Agent, newEnc: number): boolean {
    const W = this.config.gridWidth;
    const oldEnc = agent.y * W + agent.x;
    if (this.grid[newEnc] !== null) return false;

    this.grid[oldEnc] = null;
    this.addEmptySpot(oldEnc);
    this.grid[newEnc] = agent;
    this.removeEmptySpot(newEnc);

    const oldX = agent.x, oldY = agent.y;
    agent.x = newEnc % W;
    agent.y = (newEnc / W) | 0;
    this.markAgentChanged(agent, 'position');

    // O(9) incremental update for each affected neighbourhood
    this.updateSatisfactionAt(oldX, oldY);
    this.updateSatisfactionAt(agent.x, agent.y);

    return true;
  }

  // ── Simulation step ─────────────────────────────────────────────────────────

  step(): boolean {
    this.emit('step_start', { timeStep: this.timeStep });

    // O(U) snapshot instead of O(N) filter; satisfaction is maintained incrementally
    const unsatisfied = Array.from(this.unsatisfiedSet);
    this.shuffleArray(unsatisfied);
    const empties = this.emptySpots.slice();
    this.shuffleArray(empties);

    const moveCount = Math.min(unsatisfied.length, empties.length);
    let moved = 0;
    for (let i = 0; i < moveCount; i++) {
      if (this.moveAgentTo(unsatisfied[i], empties[i])) {
        moved++;
      }
    }

    this.segregationIndex = this.calculateSegregationIndex();
    this.emit('step_end', { timeStep: this.timeStep });
    this.timeStep++;
    return moved > 0;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = (this.random() * (i + 1)) | 0;
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // ── Data access ─────────────────────────────────────────────────────────────

  private getAgentColor(type: 1 | 2): string {
    return SchellingModel.AGENT_TYPES.find(t => t.type === type)?.color ?? '#000000';
  }

  takeAgentUpdates(): SchellingAgentUpdate[] {
    const updates = [...this.agentChanges].map(([agent, changes]) => ({
      id: agent.id,
      ...(changes.position ? { x: agent.x, y: agent.y } : {}),
      ...(changes.appearance
        ? { size: agent.satisfied ? this.config.agentSize : this.config.agentSizeUnsatisfied }
        : {}),
    }));
    this.agentChanges.clear();
    return updates;
  }

  getEnvironmentState(): SimpleGridEnv {
    return {
      id: 'main',
      type: 'grid' as const,
      width: this.config.gridWidth,
      height: this.config.gridHeight,
      agents: this.agents.map(agent => ({
        id: agent.id,
        x: agent.x,
        y: agent.y,
        heading: 0,
        color: this.getAgentColor(agent.type),
        icon: 'circle' as const,
        size: agent.satisfied ? this.config.agentSize : this.config.agentSizeUnsatisfied,
        data: { type: agent.type },
      })),
    };
  }

  /** Prepare the model-owned grid for a complete declarative layer restore. */
  prepareRestoredAgents(): void {
    const size = this.config.gridWidth * this.config.gridHeight;
    this.agents = [];
    this.agentChanges.clear();
    this.grid = new Array(size).fill(null);
    this.emptySpots = Array.from({ length: size }, (_, index) => index);
    this.emptySpotIndexMap = new Map(this.emptySpots.map((encoded, index) => [encoded, index]));
    this.unsatisfiedSet.clear();
    this.satisfiedCount = 0;
    this.segregationIndex = 0;
  }

  /** Validate a complete renderer-projected agent layer before it mutates this model. */
  validateRestoredAgents(items: readonly Record<string, unknown>[], metadata?: Record<string, unknown>): void {
    const width = typeof metadata?.width === 'number' ? Math.floor(metadata.width) : this.config.gridWidth;
    const height = typeof metadata?.height === 'number' ? Math.floor(metadata.height) : this.config.gridHeight;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error('Restored Schelling layer metadata requires positive integer width and height.');
    }
    const ids = new Set<string>();
    const positions = new Set<number>();
    for (const item of items) {
      const id = item.id;
      const x = item.x;
      const y = item.y;
      const data = item.data;
      const type = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).type
        : undefined;
      if (typeof id !== 'string' || typeof x !== 'number' || typeof y !== 'number'
        || !Number.isInteger(x) || !Number.isInteger(y)
        || x < 0 || x >= width || y < 0 || y >= height || (type !== 1 && type !== 2)) {
        throw new Error('Restored Schelling agents require unique string IDs, in-bounds integer coordinates, and data.type of 1 or 2.');
      }
      if (ids.has(id) || positions.has(y * width + x)) {
        throw new Error('Restored Schelling agents must not duplicate an ID or grid position.');
      }
      ids.add(id);
      positions.add(y * width + x);
    }
  }

  restoreAgent(item: Record<string, unknown>): void {
    const id = item.id as string;
    const x = item.x as number;
    const y = item.y as number;
    const data = item.data as Record<string, unknown>;
    const type = data.type as 1 | 2;
    const existingIndex = this.agents.findIndex((agent) => agent.id === id);
    if (existingIndex >= 0) {
      const existing = this.agents[existingIndex];
      const existingPosition = existing.y * this.config.gridWidth + existing.x;
      this.grid[existingPosition] = null;
      if (!this.emptySpotIndexMap.has(existingPosition)) this.addEmptySpot(existingPosition);
      this.agents.splice(existingIndex, 1);
    }
    const position = y * this.config.gridWidth + x;
    const occupant = this.grid[position];
    if (occupant) {
      const occupantIndex = this.agents.indexOf(occupant);
      if (occupantIndex >= 0) this.agents.splice(occupantIndex, 1);
    }
    if (this.emptySpotIndexMap.has(position)) this.removeEmptySpot(position);
    const agent: Agent = { id, x, y, type, satisfied: false };
    this.grid[position] = agent;
    this.agents.push(agent);
  }

  deleteRestoredAgent(key: string | number | Record<string, unknown>): void {
    const id = typeof key === 'object' && key !== null ? key.id : key;
    if (typeof id !== 'string') return;
    const index = this.agents.findIndex((agent) => agent.id === id);
    if (index < 0) return;
    const [agent] = this.agents.splice(index, 1);
    const position = agent.y * this.config.gridWidth + agent.x;
    this.grid[position] = null;
    if (!this.emptySpotIndexMap.has(position)) this.addEmptySpot(position);
  }

  restoreGridMetadata(metadata: Record<string, unknown>): void {
    const width = metadata.width;
    const height = metadata.height;
    if (typeof width !== 'number' || typeof height !== 'number'
      || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new Error('Restored Schelling layer metadata requires positive integer width and height.');
    }
    this.updateConfig({ gridWidth: width, gridHeight: height });
    this.prepareRestoredAgents();
  }

  finishRestoredAgents(): void {
    this.updateAllSatisfaction();
    this.segregationIndex = this.calculateSegregationIndex();
    this.agentChanges.clear();
  }

  restoreTime(time: number): void {
    this.timeStep = time;
  }

  captureCheckpointData(): ProtocolValue {
    return {
      config: this.getConfig() as unknown as Record<string, ProtocolValue>,
      time: this.timeStep,
      agents: this.getEnvironmentState().agents as unknown as ProtocolValue[],
    };
  }

  restoreCheckpointData(data: unknown): void {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error('Schelling checkpoint must be an object.');
    }
    const checkpoint = data as Record<string, unknown>;
    const config = checkpoint.config;
    const agents = checkpoint.agents;
    const time = checkpoint.time;
    if (typeof config !== 'object' || config === null || Array.isArray(config)
      || !Array.isArray(agents) || typeof time !== 'number' || !Number.isFinite(time)) {
      throw new Error('Schelling checkpoint requires config, finite time, and agents.');
    }
    const records = agents.map((agent) => {
      if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) {
        throw new Error('Schelling checkpoint agents must be objects.');
      }
      return agent as Record<string, unknown>;
    });
    const configPatch = config as Record<string, unknown>;
    const width = configPatch.gridWidth;
    const height = configPatch.gridHeight;
    if (typeof width !== 'number' || typeof height !== 'number') {
      throw new Error('Schelling checkpoint config requires gridWidth and gridHeight.');
    }
    this.updateConfig(configPatch as Partial<SchellingConfig>);
    this.validateRestoredAgents(records, { width, height });
    this.prepareRestoredAgents();
    for (const agent of records) this.restoreAgent(agent);
    this.restoreTime(time);
    this.finishRestoredAgents();
  }

  getStatistics() {
    return {
      timeStep: this.timeStep,
      totalAgents: this.agents.length,
      satisfiedCount: this.satisfiedCount,
      satisfactionRate: this.agents.length > 0 ? this.satisfiedCount / this.agents.length : 0,
      segregationIndex: this.segregationIndex,
    };
  }

  getParameters() {
    const paramDefs: Array<{
      id: keyof Omit<SchellingConfig, 'seed'> | string;
      type: string;
      label: string;
      value?: any;
      min?: number;
      max?: number;
      step?: number;
      allow_runtime_change: boolean;
    }> = [
      { id: 'gridWidth', type: 'number', label: 'Grid Width', min: 10, max: 100, step: 1, allow_runtime_change: false },
      { id: 'gridHeight', type: 'number', label: 'Grid Height', min: 10, max: 100, step: 1, allow_runtime_change: false },
      { id: 'similarityThreshold', type: 'number', label: 'Similarity Threshold', min: 0, max: 1, step: 0.05, allow_runtime_change: true },
      { id: 'density', type: 'number', label: 'Density', min: 0, max: 1, step: 0.05, allow_runtime_change: false },
      { id: 'balance', type: 'number', label: 'Balance', min: 0, max: 1, step: 0.05, allow_runtime_change: false },
    ];
    return paramDefs.map(p => ({ ...p, value: this.config[p.id as keyof typeof this.config] }));
  }

  updateParameter(id: string, value: any) {
    (this.config as any)[id] = typeof value === 'number' && ['similarityThreshold', 'density', 'balance'].includes(id)
      ? SchellingModel.clamp01(value)
      : value;
    if (id === 'similarityThreshold') this.updateAllSatisfaction(true);
  }

  // ── Simulation control ──────────────────────────────────────────────────────

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = window.setInterval(() => this.step(), 50);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reset() {
    this.stop();
    this.initialize();
  }

  destroy() {
    this.stop();
    this.agents = [];
    this.agentChanges.clear();
    this.grid = [];
    this.emptySpots = [];
    this.emptySpotIndexMap.clear();
    this.unsatisfiedSet.clear();
  }

  getIsRunning(): boolean { return this.isRunning; }

  getConfig(): SchellingConfig { return { ...this.config }; }

  updateConfig(updates: Partial<SchellingConfig>) {
    Object.assign(this.config, updates);
    if (updates.similarityThreshold !== undefined) {
      this.config.similarityThreshold = SchellingModel.clamp01(updates.similarityThreshold);
    }
    if (updates.density !== undefined) {
      this.config.density = SchellingModel.clamp01(updates.density);
    }
    if (updates.balance !== undefined) {
      this.config.balance = SchellingModel.clamp01(updates.balance);
    }
    if ('similarityThreshold' in updates) this.updateAllSatisfaction(true);
  }
}
