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
  private config: SchellingConfig;
  private agents: Agent[] = [];
  private lastUnsatisfiedAgents: Agent[] | undefined = undefined;
  private grid: (Agent | null)[][];
  private timeStep: number = 0;
  private isRunning: boolean = false;
  private intervalId: number | null = null;
  private readonly eventHandlers: { [event: string]: Function[] } = {};
  private satisfiedCount: number = 0;
  private segregationIndex: number = 0;

  // Agent type configurations
  private static readonly AGENT_TYPES = [
    { type: 1, color: '#3498db', prefix: 'agent1' },
    { type: 2, color: '#e74c3c', prefix: 'agent2' }
  ] as const;

  constructor(config: SchellingConfig) {
    this.config = config;
    this.grid = this.createEmptyGrid();
  }

  // Event handling
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

  // Grid operations
  private createEmptyGrid(): (Agent | null)[][] {
    return Array(this.config.gridHeight).fill(null).map(() =>
      Array(this.config.gridWidth).fill(null)
    );
  }

  private getEmptySpots(): [number, number][] {
    const spots: [number, number][] = [];
    for (let y = 0; y < this.config.gridHeight; y++) {
      for (let x = 0; x < this.config.gridWidth; x++) {
        if (this.grid[y][x] === null) {
          spots.push([x, y]);
        }
      }
    }
    return spots;
  }

  private isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.config.gridWidth && y >= 0 && y < this.config.gridHeight;
  }

  // Initialization
  initialize() {
    this.agents = [];
    this.lastUnsatisfiedAgents = undefined;
    this.grid = this.createEmptyGrid();
    this.timeStep = 0;
    this.satisfiedCount = 0;
    this.segregationIndex = 0;

    // Create agents for both types
    const agentCounts = [this.config.numAgentsType1, this.config.numAgentsType2];
    SchellingModel.AGENT_TYPES.forEach(({ type, prefix }, index) => {
      for (let i = 0; i < agentCounts[index]; i++) {
        const agent: Agent = {
          id: `${prefix}_${i}`,
          x: 0,
          y: 0,
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
    const emptySpots = this.getEmptySpots();
    if (emptySpots.length === 0) return false;

    const [x, y] = emptySpots[Math.floor(Math.random() * emptySpots.length)];
    agent.x = x;
    agent.y = y;
    this.grid[y][x] = agent;
    return true;
  }

  // Neighbor analysis
  private getNeighbors(x: number, y: number): Agent[] {
    const neighbors: Agent[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (this.isValidPosition(nx, ny) && this.grid[ny][nx]) {
          neighbors.push(this.grid[ny][nx]!);
        }
      }
    }
    return neighbors;
  }

  private calculateSimilarityRatio(agent: Agent, x: number = agent.x, y: number = agent.y): number {
    const neighbors = this.getNeighbors(x, y);
    if (neighbors.length === 0) return 1;
    const similarCount = neighbors.filter(n => n.type === agent.type).length;
    return similarCount / neighbors.length;
  }

  private calculateSatisfaction(agent: Agent): boolean {
    return this.calculateSimilarityRatio(agent) >= this.config.similarityThreshold;
  }

  private updateAllSatisfaction() {
    this.satisfiedCount = 0;
    for (const agent of this.agents) {
      agent.satisfied = this.calculateSatisfaction(agent);
      if (agent.satisfied) this.satisfiedCount++;
    }
  }

  private calculateSegregationIndex(): number {
    let totalSimilarity = 0, count = 0;
    for (const agent of this.agents) {
      const neighbors = this.getNeighbors(agent.x, agent.y);
      if (neighbors.length > 0) {
        totalSimilarity += this.calculateSimilarityRatio(agent);
        count++;
      }
    }
    return count > 0 ? totalSimilarity / count : 0;
  }

  // Agent movement
  private moveAgent(agent: Agent): boolean {
    const candidates = this.findCandidateLocations(agent);
    if (candidates.length === 0) return false;

    this.grid[agent.y][agent.x] = null;
    const [newX, newY] = candidates[Math.floor(Math.random() * candidates.length)];
    agent.x = newX;
    agent.y = newY;
    this.grid[newY][newX] = agent;
    return true;
  }

  private findCandidateLocations(agent: Agent): [number, number][] {
    const satisfyingSpots: [number, number][] = [];

    for (let y = 0; y < this.config.gridHeight; y++) {
      for (let x = 0; x < this.config.gridWidth; x++) {
        if (this.grid[y][x] !== null) continue;

        const ratio = this.calculateSimilarityRatio(agent, x, y);
        if (ratio >= this.config.similarityThreshold) {
          const distance = Math.abs(x - agent.x) + Math.abs(y - agent.y);
          if (distance <= this.config.moveDistance) {
            satisfyingSpots.push([x, y]);
          }
        }
      }
    }

    return satisfyingSpots.length > 0 ? satisfyingSpots : this.getEmptySpots();
  }

  // Simulation step
  step() {
    this.lastUnsatisfiedAgents = undefined;
    this.emit('step_start', { timeStep: this.timeStep });

    const unsatisfiedAgents = this.agents.filter(a => !a.satisfied);
    this.shuffleArray(unsatisfiedAgents);

    const moveCount = Math.min(unsatisfiedAgents.length, Math.ceil(unsatisfiedAgents.length * 0.3));
    for (let i = 0; i < moveCount; i++) {
      this.moveAgent(unsatisfiedAgents[i]);
    }

    this.updateAllSatisfaction();
    this.segregationIndex = this.calculateSegregationIndex();
    this.lastUnsatisfiedAgents = unsatisfiedAgents;

    this.emit('step_end', { timeStep: this.timeStep });
    this.timeStep++;
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  // Data access
  private getAgentColor(type: 1 | 2): string {
    return SchellingModel.AGENT_TYPES.find(t => t.type === type)?.color ?? '#000000';
  }

  getAgentUpdates(full = false): any[] {
    const agentsToUpdate = full ? this.agents : this.lastUnsatisfiedAgents ?? [];
    return agentsToUpdate.map(agent => ({
      id: agent.id,
      data: {
        x: agent.x,
        y: agent.y,
        color: this.getAgentColor(agent.type),
        icon: 'circle',
        size: agent.satisfied ? 10 : 6,
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
        size: agent.satisfied ? 10 : 6,
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
    this.config[id as keyof SchellingConfig] = value;
    if (id === 'similarityThreshold') {
      this.updateAllSatisfaction();
    }
  }

  // Simulation control
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
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getConfig(): SchellingConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SchellingConfig>) {
    Object.assign(this.config, updates);
    if ('similarityThreshold' in updates) {
      this.updateAllSatisfaction();
    }
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