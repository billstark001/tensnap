/**
 * Schelling Segregation Model
 * 
 * A classic agent-based model demonstrating how individual preferences
 * for similar neighbors can lead to large-scale segregation patterns.
 * 
 * Based on Thomas Schelling's work on racial segregation (1969, 1971).
 */

import type {
  Environment,
  Parameter,
  ChartGroupMetadata,
  GridEnvironment,
} from 'tensnap-web';

import { BaseSimulationManager, createFakeWebSocketOptions, FakeWebSocketOptions } from './common';

export interface SchellingConfig {
  agentSize?: number;
  agentSizeUnsatisfied?: number;
  gridWidth: number;
  gridHeight: number;
  numAgentsType1: number;
  numAgentsType2: number;
  similarityThreshold: number;
  moveDistance: number;
}

interface Agent {
  id: string;
  x: number;
  y: number;
  type: 1 | 2;
  satisfied: boolean;
}

export class SchellingModel {
  private config: Required<SchellingConfig>;
  private agents: Agent[] = [];
  private lastUnsatisfiedAgents: Agent[] | undefined = undefined;

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
    this.config = {
      agentSize: 1,
      agentSizeUnsatisfied: (config.agentSize ?? 1) * 0.6,
      ...config,
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
    this.agents = [];
    this.lastUnsatisfiedAgents = undefined;
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

    const agentCounts = [this.config.numAgentsType1, this.config.numAgentsType2];
    SchellingModel.AGENT_TYPES.forEach(({ type, prefix }, index) => {
      for (let i = 0; i < agentCounts[index]; i++) {
        const agent: Agent = {
          id: `${prefix}_${i}`,
          x: 0, y: 0,
          type: type as 1 | 2,
          satisfied: false,
        };
        this.placeAgentRandomly(agent);
        this.agents.push(agent);
      }
    });

    this.updateAllSatisfaction();
  }

  private placeAgentRandomly(agent: Agent): boolean {
    if (this.emptySpots.length === 0) return false;
    const enc = this.emptySpots[(Math.random() * this.emptySpots.length) | 0];
    const W = this.config.gridWidth;
    agent.x = enc % W;
    agent.y = (enc / W) | 0;
    this.grid[enc] = agent;
    this.removeEmptySpot(enc);
    return true;
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
  private updateAllSatisfaction(): void {
    this.satisfiedCount = 0;
    this.unsatisfiedSet.clear();
    for (const agent of this.agents) {
      agent.satisfied = this.calculateSatisfaction(agent);
      if (agent.satisfied) {
        this.satisfiedCount++;
      } else {
        this.unsatisfiedSet.add(agent);
      }
    }
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

  private moveAgent(agent: Agent): boolean {
    const candidates = this.findCandidateLocations(agent);
    if (candidates.length === 0) return false;

    const W = this.config.gridWidth;
    const oldEnc = agent.y * W + agent.x;
    // Capture newEnc before any pool mutation (safe even when candidates === this.emptySpots)
    const newEnc = candidates[(Math.random() * candidates.length) | 0];

    this.grid[oldEnc] = null;
    this.addEmptySpot(oldEnc);
    this.grid[newEnc] = agent;
    this.removeEmptySpot(newEnc);

    const oldX = agent.x, oldY = agent.y;
    agent.x = newEnc % W;
    agent.y = (newEnc / W) | 0;

    // O(9) incremental update for each affected neighbourhood
    this.updateSatisfactionAt(oldX, oldY);
    this.updateSatisfactionAt(agent.x, agent.y);

    return true;
  }

  /**
   * Candidate search restricted to the Manhattan-distance diamond of radius
   * moveDistance: O(d²) instead of O(W×H).
   *
   * Fallback returns this.emptySpots directly (no copy); newEnc is captured
   * before the pool is mutated in moveAgent, so this is safe.
   */
  private findCandidateLocations(agent: Agent): number[] {
    const { moveDistance: d, similarityThreshold: thresh, gridWidth: W, gridHeight: H } = this.config;
    const { x, y } = agent;
    const grid = this.grid;
    const satisfying: number[] = [];

    for (let dy = -d; dy <= d; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const rowOff = ny * W;
      const maxDx = d - Math.abs(dy);
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const enc = rowOff + nx;
        if (grid[enc] !== null) continue;
        if (this.calculateSimilarityRatio(agent, nx, ny) >= thresh) {
          satisfying.push(enc);
        }
      }
    }

    return satisfying.length > 0 ? satisfying : this.emptySpots;
  }

  // ── Simulation step ─────────────────────────────────────────────────────────

  step() {
    this.lastUnsatisfiedAgents = undefined;
    this.emit('step_start', { timeStep: this.timeStep });

    // O(U) snapshot instead of O(N) filter; satisfaction is maintained incrementally
    const unsatisfied = Array.from(this.unsatisfiedSet);
    this.shuffleArray(unsatisfied);

    const moveCount = Math.ceil(unsatisfied.length * 0.3);
    for (let i = 0; i < moveCount; i++) {
      this.moveAgent(unsatisfied[i]);
    }

    this.segregationIndex = this.calculateSegregationIndex();
    this.lastUnsatisfiedAgents = unsatisfied;

    this.emit('step_end', { timeStep: this.timeStep });
    this.timeStep++;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // ── Data access ─────────────────────────────────────────────────────────────

  private getAgentColor(type: 1 | 2): string {
    return SchellingModel.AGENT_TYPES.find(t => t.type === type)?.color ?? '#000000';
  }

  getAgentUpdates(full = false): {
    id: string;
    data: { id: string; x: number; y: number; color: string; icon: 'circle'; size: number };
    operation: 'create' | 'update';
  }[] {
    const agentsToUpdate = full ? this.agents : this.lastUnsatisfiedAgents ?? [];
    return agentsToUpdate.map(agent => ({
      id: agent.id,
      data: {
        id: agent.id,
        x: agent.x,
        y: agent.y,
        color: this.getAgentColor(agent.type),
        icon: 'circle',
        size: agent.satisfied ? this.config.agentSize : this.config.agentSizeUnsatisfied,
      },
      operation: full ? 'create' : 'update',
    }));
  }

  getEnvironmentState(): GridEnvironment {
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
      })),
    };
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
      id: keyof SchellingConfig | string;
      type: string;
      label: string;
      value?: any;
      min?: number;
      max?: number;
      step?: number;
      allowRuntimeChange: boolean;
    }> = [
      { id: 'similarityThreshold', type: 'number', label: 'Similarity Threshold', min: 0, max: 1, step: 0.05, allowRuntimeChange: true },
      { id: 'moveDistance', type: 'number', label: 'Move Distance', min: 1, max: 10, step: 1, allowRuntimeChange: true },
      { id: 'gridWidth', type: 'number', label: 'Grid Width', min: 10, max: 100, step: 1, allowRuntimeChange: false },
      { id: 'gridHeight', type: 'number', label: 'Grid Height', min: 10, max: 100, step: 1, allowRuntimeChange: false },
      { id: 'numAgentsType1', type: 'number', label: 'Number of Type 1 Agents', min: 10, max: 1000, step: 10, allowRuntimeChange: false },
      { id: 'numAgentsType2', type: 'number', label: 'Number of Type 2 Agents', min: 10, max: 1000, step: 10, allowRuntimeChange: false },
    ];
    return paramDefs.map(p => ({ ...p, value: this.config[p.id as keyof SchellingConfig] }));
  }

  updateParameter(id: string, value: any) {
    (this.config as any)[id] = value;
    if (id === 'similarityThreshold') this.updateAllSatisfaction();
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
    this.lastUnsatisfiedAgents = undefined;
    this.grid = [];
    this.emptySpots = [];
    this.emptySpotIndexMap.clear();
    this.unsatisfiedSet.clear();
  }

  getIsRunning(): boolean { return this.isRunning; }

  getConfig(): SchellingConfig { return { ...this.config }; }

  updateConfig(updates: Partial<SchellingConfig>) {
    Object.assign(this.config, updates);
    if ('similarityThreshold' in updates) this.updateAllSatisfaction();
  }
}

// #region Simulation Manager

class SchellingSimulationManager extends BaseSimulationManager {
  private model: SchellingModel;

  constructor(config: SchellingConfig) {
    super({
      name: 'Schelling Segregation Model',
      description: 'Demonstrates how individual preferences for similar neighbors lead to large-scale segregation patterns.',
    });

    this.model = new SchellingModel(config);
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.model.on('step_start', async ({ timeStep }: any) => {
      await this.sendTimeStepStart(timeStep);
    });

    this.model.on('step_end', async () => {
      await this.sendAgentBatchUpdate({
        environment_id: 'main',
        updates: this.model.getAgentUpdates(false),
      });

      const stats = this.model.getStatistics();
      await this.sendChartUpdate({
        updates: [
          { id: 'satisfaction_rate', value: stats.satisfactionRate },
          { id: 'segregation_index', value: stats.segregationIndex },
        ],
      });

      await this.sendTimeStepEnd();
    });
  }

  protected getParameters(): Parameter[] {
    const config = this.model.getConfig();

    const numberParams: Parameter[] = [
      { id: 'similarityThreshold', type: 'number', label: 'Similarity Threshold', value: config.similarityThreshold, min: 0, max: 1, step: 0.05, allowRuntimeChange: true },
      { id: 'moveDistance', type: 'number', label: 'Move Distance', value: config.moveDistance, min: 1, max: 10, step: 1, allowRuntimeChange: true },
      { id: 'gridWidth', type: 'number', label: 'Grid Width', value: config.gridWidth, min: 10, max: 100, step: 1, allowRuntimeChange: false },
      { id: 'gridHeight', type: 'number', label: 'Grid Height', value: config.gridHeight, min: 10, max: 100, step: 1, allowRuntimeChange: false },
      { id: 'numAgentsType1', type: 'number', label: 'Number of Type 1 Agents', value: config.numAgentsType1, min: 10, max: 1000, step: 10, allowRuntimeChange: false },
      { id: 'numAgentsType2', type: 'number', label: 'Number of Type 2 Agents', value: config.numAgentsType2, min: 10, max: 1000, step: 10, allowRuntimeChange: false },
    ];

    const actionButtons: Parameter[] = ['start', 'stop', 'step', 'reset', 'start_stop'].map(id => ({
      id,
      type: 'action' as const,
      label: id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('/'),
      allowRuntimeChange: true,
    }));

    return [...numberParams, ...actionButtons];
  }

  protected getEnvironments(): Environment[] {
    return [this.model.getEnvironmentState()];
  }

  protected getCharts(): ChartGroupMetadata[] {
    return [
      { id: 'satisfaction_rate', label: 'Satisfaction Rate', color: '#2ecc71' },
      { id: 'segregation_index', label: 'Segregation Index', color: '#e74c3c' },
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
      start: () => this.model.start(),
      stop: () => this.model.stop(),
      step: () => this.model.step(),
      reset: async () => {
        this.model.reset();
        await this.sendChartUpdate({
          operations: [
            { id: 'satisfaction_rate', operation: 'clear' },
            { id: 'segregation_index', operation: 'clear' },
          ],
        });
        await this.sendInitialData();
      },
      start_stop: () => this.model.getIsRunning() ? this.model.stop() : this.model.start(),
    };
    await actions[action]?.();
  }

  protected async initialize(): Promise<void> {
    this.model.initialize();
  }

  protected async cleanup(): Promise<void> {
    this.model.destroy();
  }

  private async sendInitialData(): Promise<void> {
    // Send environment with full agent list
    await this.sendEnvironmentUpdate({
      id: 'main',
      data: {
        type: 'grid',
        width: this.model.getConfig().gridWidth,
        height: this.model.getConfig().gridHeight,
      },
      agents: this.model.getEnvironmentState().agents,
    });
    // await this.sendAgentBatchUpdate({
    //   environment_id: 'main',
    //   updates: this.model.getAgentUpdates(true),
    // });

    // Send initial chart data
    const stats = this.model.getStatistics();
    await this.sendChartUpdate({
      updates: [
        { id: 'satisfaction_rate', value: stats.satisfactionRate, time: 0 },
        { id: 'segregation_index', value: stats.segregationIndex, time: 0 },
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

// #endregion

/**
 * Create a fake WebSocket simulation for the Schelling model
 */
export function createSchellingSimulation(config?: Partial<SchellingConfig>): FakeWebSocketOptions {
  const defaultConfig: SchellingConfig = {
    gridWidth: 50,
    gridHeight: 50,
    numAgentsType1: 600,
    numAgentsType2: 600,
    similarityThreshold: 0.4,
    moveDistance: 10,
  };

  const manager = new SchellingSimulationManager({ ...defaultConfig, ...config });
  return createFakeWebSocketOptions(manager);
}