/**
 * cases/schellingModel.ts
 *
 * Benchmark: Schelling Segregation Model using direct model integration.
 * 
 * This case uses the SchellingModel class directly from web-utils.
 * It demonstrates incremental agent updates where only agents that changed
 * state are updated in the storage, improving performance.
 */

import {
  EnvironmentView,
  AgentStorage,
  GridEnvStorage,
  AgentLayer,
  GridLayer,
} from '@tensnap/core/environment';
import { LineChartView } from '@tensnap/core/chart';
import { RenderableAgent } from '@tensnap/core/environment';
import { BenchmarkCase } from '../types';

// Import the model from web-utils
import { SchellingModel, SchellingConfig } from '@tensnap/web-adapter/models';

interface BenchmarkConfig extends Partial<SchellingConfig> {
  /** Canvas width for environment view */
  envWidth?: number;
  /** Canvas height for environment view */
  envHeight?: number;
  /** Chart width */
  chartWidth?: number;
  /** Chart height */
  chartHeight?: number;
  /** Auto-run the simulation */
  autoRun?: boolean;
}

export function createSchellingCase(partial: BenchmarkConfig = {}): BenchmarkCase {
  const modelConfig: SchellingConfig = {
    gridWidth: partial.gridWidth ?? 40,
    gridHeight: partial.gridHeight ?? 40,
    numAgentsType1: partial.numAgentsType1 ?? 500,
    numAgentsType2: partial.numAgentsType2 ?? 500,
    similarityThreshold: partial.similarityThreshold ?? 0.4,
    moveDistance: partial.moveDistance ?? 10,
  };

  const cfg = {
    ...modelConfig,
    envWidth: partial.envWidth ?? 600,
    envHeight: partial.envHeight ?? 600,
    chartWidth: partial.chartWidth ?? 600,
    chartHeight: partial.chartHeight ?? 200,
    autoRun: partial.autoRun ?? true,
  };

  let model: SchellingModel | null = null;
  let view: EnvironmentView | null = null;
  let chart: LineChartView | null = null;
  let agentStorage: AgentStorage | null = null;
  let gridStorage: GridEnvStorage | null = null;
  let host: HTMLElement | null = null;
  let chartData: Array<{ time: number; satisfaction: number; segregation: number }> = [];
  let timeStep = 0;

  function convertAgentsToRenderable(): RenderableAgent[] {
    const env = model!.getEnvironmentState();
    return env.agents.map(a => ({
      ...a,
      icon: 'circle' as const,
    }));
  }

  function getChangedAgents(): RenderableAgent[] {
    // Get agents that changed in the last step
    const updates = model!.getAgentUpdates(false);
    return updates.map(u => ({
      // id: u.id,
      ...u.data,
      icon: 'circle' as const,
    } as RenderableAgent));
  }

  function updateStats(): void {
    const stats = model!.getStatistics();
    chartData.push({
      time: timeStep++,
      satisfaction: stats.satisfactionRate,
      segregation: stats.segregationIndex,
    });

    // Keep only last 200 points
    if (chartData.length > 200) {
      chartData = chartData.slice(-200);
    }

    chart!.updateData(chartData);
  }

  return {
    name: 'Schelling Segregation Model',
    config: cfg as unknown as Record<string, unknown>,

    setup(container) {
      host = document.createElement('div');
      host.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 10px;
      `;
      container.appendChild(host);

      // Create environment view container
      const envContainer = document.createElement('div');
      envContainer.style.cssText = `
        width: ${cfg.envWidth}px;
        height: ${cfg.envHeight}px;
        overflow: hidden;
        border: 1px solid #ccc;
      `;
      host.appendChild(envContainer);

      // Create chart container
      const chartContainer = document.createElement('div');
      chartContainer.style.cssText = `
        width: ${cfg.chartWidth}px;
        height: ${cfg.chartHeight}px;
        overflow: hidden;
        border: 1px solid #ccc;
      `;
      host.appendChild(chartContainer);

      // Initialize model
      model = new SchellingModel(modelConfig);
      model.initialize();

      // Initialize environment view
      view = new EnvironmentView(envContainer, {
        throttleMs: 0,
      });

      agentStorage = new AgentStorage();
      gridStorage = new GridEnvStorage();

      const agentLayer = new AgentLayer(view, agentStorage, {
        clickable: false,
        sceneBounds: { width: modelConfig.gridWidth, height: modelConfig.gridHeight },
      });
      view.addLayer(agentLayer);

      const gridLayer = new GridLayer(view, gridStorage);
      view.addLayer(gridLayer);

      view.fitToScene({ padding: 0 });

      // Set initial agents
      agentStorage.setAgents(convertAgentsToRenderable());

      // Initialize chart
      chart = new LineChartView(chartContainer, {
        lines: [
          { key: 'satisfaction', name: 'Satisfaction Rate', color: '#2ecc71', strokeWidth: 2 },
          { key: 'segregation', name: 'Segregation Index', color: '#e74c3c', strokeWidth: 2 },
        ],
        showGrid: true,
        showXAxis: true,
        showYAxis: true,
        showLegend: true,
        showTooltip: false,
      });

      // Initial stats
      updateStats();
    },

    tick() {
      // Run one step of the model
      model!.step();

      // Use incremental update - only update changed agents
      const changedAgents = getChangedAgents();
      if (changedAgents.length > 0) {
        agentStorage!.updateAgents(changedAgents);
      }

      // Update statistics chart
      updateStats();
    },

    teardown() {
      model?.destroy();
      view?.destroy();
      chart?.destroy();
      host?.remove();
      model = null;
      view = null;
      chart = null;
      agentStorage = null;
      gridStorage = null;
      host = null;
      chartData = [];
      timeStep = 0;
    },
  };
}

/**
 * Schelling Model Variations
 */
export const schellingVariations = [
  // Small grid, low density
  createSchellingCase({
    gridWidth: 30,
    gridHeight: 30,
    numAgentsType1: 400,
    numAgentsType2: 400,
    similarityThreshold: 0.8,
    moveDistance: 8,
    envWidth: 500,
    envHeight: 500,
  }),
  // Medium grid, medium density
  createSchellingCase({
    gridWidth: 40,
    gridHeight: 40,
    numAgentsType1: 700,
    numAgentsType2: 700,
    similarityThreshold: 0.85,
    moveDistance: 10,
    envWidth: 600,
    envHeight: 600,
  }),
  // Large grid, high density
  createSchellingCase({
    gridWidth: 80,
    gridHeight: 80,
    numAgentsType1: 2500,
    numAgentsType2: 2500,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
  // Large grid, high density
  createSchellingCase({
    gridWidth: 120,
    gridHeight: 120,
    numAgentsType1: 5800,
    numAgentsType2: 5800,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
];
