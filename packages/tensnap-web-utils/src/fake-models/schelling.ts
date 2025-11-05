/**
 * Schelling Segregation Model
 * 
 * A classic agent-based model demonstrating how individual preferences
 * for similar neighbors can lead to large-scale segregation patterns.
 * 
 * Based on Thomas Schelling's work on racial segregation (1969, 1971).
 */

// Type definitions to avoid circular dependency
export interface WSMessage<T = any> {
  type: string;
  payload: T;
}

export interface FakeWebSocketOptions {
  onMessage?: (message: WSMessage) => void;
  onSendMessageFuncReady?: (sendFunc: (message: WSMessage) => void, wsManager: any) => void;
  connectDelay?: number;
}

export interface SchellingConfig {
  gridWidth: number;
  gridHeight: number;
  numAgentsType1: number;
  numAgentsType2: number;
  similarityThreshold: number; // 0-1, preference for similar neighbors
  moveDistance: number; // How far agents search for new locations
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

  on(event: string, handler: Function) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  off(event: string, handler: Function) {
    if (!this.eventHandlers[event]) return;
    this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
  }

  private emit(event: string, ...args: any[]) {
    if (!this.eventHandlers[event]) return;
    for (const handler of this.eventHandlers[event]) {
      handler(...args);
    }
  }

  // Statistics
  private satisfiedCount: number = 0;
  private segregationIndex: number = 0;

  constructor(config: SchellingConfig) {
    this.config = config;
    this.grid = Array(config.gridHeight).fill(null).map(() =>
      Array(config.gridWidth).fill(null)
    );
  }

  initialize() {
    this.agents = [];
    this.lastUnsatisfiedAgents = undefined;
    this.grid = Array(this.config.gridHeight).fill(null).map(() =>
      Array(this.config.gridWidth).fill(null)
    );
    this.timeStep = 0;
    this.satisfiedCount = 0;
    this.segregationIndex = 0;

    // Create type 1 agents (blue)
    for (let i = 0; i < this.config.numAgentsType1; i++) {
      const agent: Agent = {
        id: `agent1_${i}`,
        x: 0,
        y: 0,
        type: 1,
        satisfied: false,
      };
      this.placeAgentRandomly(agent);
      this.agents.push(agent);
    }

    // Create type 2 agents (red)
    for (let i = 0; i < this.config.numAgentsType2; i++) {
      const agent: Agent = {
        id: `agent2_${i}`,
        x: 0,
        y: 0,
        type: 2,
        satisfied: false,
      };
      this.placeAgentRandomly(agent);
      this.agents.push(agent);
    }

    this.updateAllSatisfaction();
  }

  private placeAgentRandomly(agent: Agent): boolean {
    const emptySpots: [number, number][] = [];

    for (let y = 0; y < this.config.gridHeight; y++) {
      for (let x = 0; x < this.config.gridWidth; x++) {
        if (this.grid[y][x] === null) {
          emptySpots.push([x, y]);
        }
      }
    }

    if (emptySpots.length === 0) return false;

    const [x, y] = emptySpots[Math.floor(Math.random() * emptySpots.length)];
    agent.x = x;
    agent.y = y;
    this.grid[y][x] = agent;
    return true;
  }

  private getNeighbors(x: number, y: number): Agent[] {
    const neighbors: Agent[] = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue; // Skip self

        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < this.config.gridWidth &&
          ny >= 0 && ny < this.config.gridHeight) {
          const neighbor = this.grid[ny][nx];
          if (neighbor) {
            neighbors.push(neighbor);
          }
        }
      }
    }

    return neighbors;
  }

  private calculateSatisfaction(agent: Agent): boolean {
    const neighbors = this.getNeighbors(agent.x, agent.y);
    if (neighbors.length === 0) return true; // No neighbors, satisfied by default

    const similarNeighbors = neighbors.filter(n => n.type === agent.type).length;
    const similarityRatio = similarNeighbors / neighbors.length;

    return similarityRatio >= this.config.similarityThreshold;
  }

  private updateAllSatisfaction() {
    this.satisfiedCount = 0;

    for (const agent of this.agents) {
      agent.satisfied = this.calculateSatisfaction(agent);
      if (agent.satisfied) {
        this.satisfiedCount++;
      }
    }
  }

  private calculateSegregationIndex(): number {
    // Calculate average similarity ratio for all agents
    let totalSimilarity = 0;
    let count = 0;

    for (const agent of this.agents) {
      const neighbors = this.getNeighbors(agent.x, agent.y);
      if (neighbors.length > 0) {
        const similarNeighbors = neighbors.filter(n => n.type === agent.type).length;
        totalSimilarity += similarNeighbors / neighbors.length;
        count++;
      }
    }

    return count > 0 ? totalSimilarity / count : 0;
  }

  private moveAgent(agent: Agent): boolean {
    // Find better location
    const candidates: [number, number][] = [];

    // Search within move distance
    const searchRadius = this.config.moveDistance;

    for (let y = 0; y < this.config.gridHeight; y++) {
      for (let x = 0; x < this.config.gridWidth; x++) {
        if (this.grid[y][x] === null) {
          // Check if this location would be satisfying
          const tempNeighbors = this.getNeighbors(x, y);
          if (tempNeighbors.length > 0) {
            const similarNeighbors = tempNeighbors.filter(n => n.type === agent.type).length;
            const ratio = similarNeighbors / tempNeighbors.length;

            if (ratio >= this.config.similarityThreshold) {
              const distance = Math.abs(x - agent.x) + Math.abs(y - agent.y);
              if (distance <= searchRadius) {
                candidates.push([x, y]);
              }
            }
          }
        }
      }
    }

    // If no satisfying locations nearby, move to any empty spot
    if (candidates.length === 0) {
      for (let y = 0; y < this.config.gridHeight; y++) {
        for (let x = 0; x < this.config.gridWidth; x++) {
          if (this.grid[y][x] === null) {
            candidates.push([x, y]);
          }
        }
      }
    }

    if (candidates.length === 0) return false;

    // Remove from old position
    this.grid[agent.y][agent.x] = null;

    // Move to new position
    const [newX, newY] = candidates[Math.floor(Math.random() * candidates.length)];
    agent.x = newX;
    agent.y = newY;
    this.grid[newY][newX] = agent;

    return true;
  }

  step() {
    // Move unsatisfied agents
    this.lastUnsatisfiedAgents = undefined;
    
    this.emit('step_start', { timeStep: this.timeStep });

    const unsatisfiedAgents = this.agents.filter(a => !a.satisfied);

    // Shuffle to avoid bias
    for (let i = unsatisfiedAgents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unsatisfiedAgents[i], unsatisfiedAgents[j]] = [unsatisfiedAgents[j], unsatisfiedAgents[i]];
    }

    // Try to move some unsatisfied agents
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

  getAgentUpdates(full = false): any[] {
    return (full ? this.agents : this.lastUnsatisfiedAgents ?? []).map(agent => ({
      id: agent.id,
      data: {
        x: agent.x, // Center in cell
        y: agent.y,
        color: agent.type === 1 ? '#3498db' : '#e74c3c', // Blue or Red
        icon: 'circle',
        size: agent.satisfied ? 12 : 8, // Larger if satisfied
        label: undefined,
      }
    }));
  }

  getEnvironmentState() {
    return {
      id: 'main',
      type: 'grid',
      width: this.config.gridWidth,
      height: this.config.gridHeight,
      agents: this.agents.map(agent => ({
        id: agent.id,
        x: agent.x,
        y: agent.y,
        color: agent.type === 1 ? '#3498db' : '#e74c3c',
        icon: 'circle',
        size: agent.satisfied ? 12 : 8,
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
    return [
      {
        id: 'similarityThreshold',
        type: 'number',
        label: 'Similarity Threshold',
        value: this.config.similarityThreshold,
        min: 0,
        max: 1,
        step: 0.05,
        allowRuntimeChange: true,
      },
      {
        id: 'moveDistance',
        type: 'number',
        label: 'Move Distance',
        value: this.config.moveDistance,
        min: 1,
        max: 10,
        step: 1,
        allowRuntimeChange: true,
      },
      {
        id: 'gridWidth',
        type: 'number',
        label: 'Grid Width',
        value: this.config.gridWidth,
        min: 10,
        max: 100,
        step: 1,
        allowRuntimeChange: false, 
      },
      {
        id: 'gridHeight',
        type: 'number',
        label: 'Grid Height',
        value: this.config.gridHeight,
        min: 10,
        max: 100,
        step: 1,
        allowRuntimeChange: false, 
      },
      {
        id: 'numAgentsType1',
        type: 'number',
        label: 'Number of Type 1 Agents',
        value: this.config.numAgentsType1,
        min: 10,
        max: 1000,
        step: 10,
        allowRuntimeChange: false, 
      },
      {
        id: 'numAgentsType2',
        type: 'number',
        label: 'Number of Type 2 Agents',
        value: this.config.numAgentsType2,
        min: 10,
        max: 1000,
        step: 10,
        allowRuntimeChange: false, 
      },
    ];
  }

  updateParameter(id: string, value: any) {
    if (id === 'similarityThreshold') {
      this.config.similarityThreshold = value;
      this.updateAllSatisfaction();
    } else {
      this.config[id as keyof SchellingConfig] = value;
    }
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.intervalId = window.setInterval(() => {
      this.step();
    }, 50);
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
}

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

  const model = new SchellingModel({ ...defaultConfig, ...config });
  model.initialize();

  let sendFuncRaw: ((message: WSMessage) => void) | undefined = undefined;

  let sendFunc = async (message: WSMessage) => {
    if (sendFuncRaw) {
      const serialized = JSON.parse(JSON.stringify(message));
      sendFuncRaw(serialized);
      await new Promise(resolve => setTimeout(resolve, 1)); // Simulate network delay
    } else {
      console.warn('Send function not ready yet.', message);
    }
  }

  const sendStateSync = async () => {

    await sendFunc({
      type: 'state_sync',
      payload: {
        mode: 'full',
        added_parameters: [
          ...model.getParameters(),
          // Add action buttons
          {
            id: 'start',
            type: 'action',
            label: 'Start',
            allowRuntimeChange: true,
          },
          {
            id: 'stop',
            type: 'action',
            label: 'Stop',
            allowRuntimeChange: true,
          },
          {
            id: 'step',
            type: 'action',
            label: 'Step',
            allowRuntimeChange: true,
          },
          {
            id: 'reset',
            type: 'action',
            label: 'Reset',
            allowRuntimeChange: true,
          },
          {
            id: 'start_stop',
            type: 'action',
            label: 'Start/Stop',
            allowRuntimeChange: true,
          }
        ],
        removed_parameters: [],
        updated_parameters: [],
        added_environments: [model.getEnvironmentState()],
        removed_environments: [],
        updated_environments: [],
        added_charts: [
          {
            id: 'satisfaction_rate',
            label: 'Satisfaction Rate',
            color: '#2ecc71',
          },
          {
            id: 'segregation_index',
            label: 'Segregation Index',
            color: '#e74c3c',
          },
        ],
        removed_charts: [],
        updated_charts: [],
      },
    });
  };

  const clearCharts = async () => {
    await sendFunc({
      type: 'chart_update',
      payload: {
        operations: [
          {
            id: 'satisfaction_rate',
            operation: 'clear',
          },
          {
            id: 'segregation_index',
            operation: 'clear',
          },
        ],
      },
    });
  };

  // Send updates periodically
  const sendUpdates = async (timeStep?: number) => {

    const stats = model.getStatistics();

    // Send time step start
    if (timeStep !== undefined) {
      await sendFunc({
        type: 'time_step_start',
        payload: { time: stats.timeStep },
      });
    }

    // Send agent updates
    const updates = model.getAgentUpdates(timeStep === 0);
    await sendFunc({
      type: 'agent_batch_update',
      payload: {
        environment_id: 'main',
        updates,
      },
    });

    // Send chart updates
    await sendFunc({
      type: 'chart_update',
      payload: {
        updates: [
          {
            id: 'satisfaction_rate',
            value: stats.satisfactionRate,
          },
          {
            id: 'segregation_index',
            value: stats.segregationIndex,
          },
        ],
      },
    });

    // Send time step end
    if (timeStep !== undefined) {
      await sendFunc({
        type: 'time_step_end',
        payload: { time: stats.timeStep },
      });
    }
  };

  model.on('step_start', async ({ timeStep }: any) => {
    await sendFunc({
      type: 'time_step_start',
      payload: { time: timeStep },
    });
  });

  model.on('step_end', async ({ timeStep }: any) => {
    await sendUpdates();
    await sendFunc({
      type: 'time_step_end',
      payload: { time: timeStep },
    });
  });

  return {
    onMessage: (message: WSMessage) => {
      // Handle incoming messages from client
      if (message.type === 'parameter_change') {
        const { id, value } = message.payload as any;
        model.updateParameter(id, value);
      } else if (message.type === 'button_click') {
        const { action } = message.payload as any;

        if (action === 'start') {
          model.start();
        } else if (action === 'stop') {
          model.stop();
        } else if (action === 'step') {
          model.step();
        } else if (action === 'reset') {
          model.reset();
          clearCharts().then(() => sendUpdates(0));
        } else if (action === 'start_stop') {
          if (model['isRunning']) {
            model.stop();
          } else {
            model.start();
          }
        }
      }
    },

    onSendMessageFuncReady: async (sendFunc, wsManager) => {
      // Send initial state sync
      sendFuncRaw = sendFunc;

      // Send initial state
      await sendStateSync();
      await sendUpdates(0);

      // Clean up on disconnect
      wsManager.on('disconnected' as any, () => {
        model.destroy();
      });
    },

    connectDelay: 100,
  };
}
