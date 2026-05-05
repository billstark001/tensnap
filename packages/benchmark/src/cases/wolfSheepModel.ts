/**
 * cases/wolfSheepModel.ts
 *
 * Benchmark: Wolf-Sheep Predation Model using direct model integration.
 * 
 * This case uses the WolfSheepModel class directly from web-utils.
 * Instead of using background+npy for grass, we render grass as a separate agent layer.
 * This demonstrates multi-layer agent rendering.
 */

import {
  EnvironmentView,
  AgentStorage,
  GridEnvStorage,
  AgentLayer,
  GridLayer,
  AgentRenderState,
} from '@tensnap/core/environment';
import { LineChartView } from '@tensnap/core/chart';
import { BenchmarkCase, CaseVariation } from '../types';

// Import the model from web-utils
import { WolfSheepModel, WolfSheepConfig, World } from '@tensnap/web-models/models';

interface BenchmarkConfig extends Partial<WolfSheepConfig> {
  /** Canvas width for environment view */
  envWidth?: number;
  /** Canvas height for environment view */
  envHeight?: number;
  /** Chart width */
  chartWidth?: number;
  /** Chart height */
  chartHeight?: number;
}

export function createWolfSheepCase(partial: BenchmarkConfig = {}): BenchmarkCase {
  const modelConfig: WolfSheepConfig = {
    modelVersion: partial.modelVersion ?? 'sheep-wolves-grass',
    initialNumberSheep: partial.initialNumberSheep ?? 100,
    initialNumberWolves: partial.initialNumberWolves ?? 50,
    sheepGainFromFood: partial.sheepGainFromFood ?? 4,
    wolfGainFromFood: partial.wolfGainFromFood ?? 20,
    grassRegrowthTime: partial.grassRegrowthTime ?? 30,
    sheepReproduce: partial.sheepReproduce ?? 4,
    wolfReproduce: partial.wolfReproduce ?? 5,
    showEnergy: partial.showEnergy ?? false,
    gridWidth: partial.gridWidth ?? 50,
    gridHeight: partial.gridHeight ?? 50,
  };

  const cfg = {
    ...modelConfig,
    envWidth: partial.envWidth ?? 700,
    envHeight: partial.envHeight ?? 700,
    chartWidth: partial.chartWidth ?? 700,
    chartHeight: partial.chartHeight ?? 200,
  };

  let model: WolfSheepModel | null = null;
  let view: EnvironmentView | null = null;
  let chart: LineChartView | null = null;
  let grassStorage: AgentStorage | null = null;
  let animalStorage: AgentStorage | null = null;
  let gridStorage: GridEnvStorage | null = null;
  let host: HTMLElement | null = null;
  let chartData: Array<{ time: number; sheep: number; wolves: number; grass: number }> = [];
  let timeStep = 0;

  function initGrassAgents(): AgentRenderState[] {
    if (modelConfig.modelVersion !== 'sheep-wolves-grass') {
      return [];
    }

    const patches = model!.getPatches();
    const grassAgents: AgentRenderState[] = [];

    for (let y = 0; y < patches.length; y++) {
      for (let x = 0; x < patches[y].length; x++) {
        const patch = patches[y][x];
        if (patch.color === 'green') {
          grassAgents.push({
            id: `grass_${x}_${y}`,
            x,
            y,
            icon: 'square' as const,
            size: 1,
            color: '#7EC850',
          });
        }
      }
    }

    return grassAgents;
  }

  function updateGrassAgents(): void {
    if (modelConfig.modelVersion !== 'sheep-wolves-grass' || !grassStorage) {
      return;
    }

    const patches = model!.getPatches();
    const toAdd: AgentRenderState[] = [];
    const toRemove: string[] = [];

    for (let y = 0; y < patches.length; y++) {
      for (let x = 0; x < patches[y].length; x++) {
        const patch = patches[y][x];
        const id = `grass_${x}_${y}`;
        const exists = grassStorage.hasAgent(id);

        if (patch.color === 'green' && !exists) {
          toAdd.push({
            id,
            x,
            y,
            icon: 'square' as const,
            size: 1,
            color: '#7EC850',
          });
        } else if (patch.color !== 'green' && exists) {
          toRemove.push(id);
        }
      }
    }

    if (toAdd.length > 0) {
      grassStorage.addAgents(toAdd);
    }
    if (toRemove.length > 0) {
      grassStorage.removeAgents(toRemove);
    }
  }

  function convertAnimalsToRenderable(): AgentRenderState[] {
    const sheep = Array.from(model!.getSheep());
    const wolves = Array.from(model!.getWolves());

    return [
      ...sheep.map((s: any, idx: number) => ({
        id: `sheep_${idx}`,
        x: s.position.x,
        y: s.position.y,
        heading: (s.heading * Math.PI) / 180,
        icon: 'circle' as const,
        size: 1,
        color: '#FFFFFF',
      } as AgentRenderState)),
      ...wolves.map((w: any, idx: number) => ({
        id: `wolf_${idx}`,
        x: w.position.x,
        y: w.position.y,
        heading: (w.heading * Math.PI) / 180,
        icon: 'circle' as const,
        size: 1,
        color: '#000000',
      } as AgentRenderState)),
    ];
  }

  function updateStats(): void {
    chartData.push({
      time: timeStep++,
      sheep: model!.getSheepCount(),
      wolves: model!.getWolfCount(),
      grass: model!.getGrassCount(),
    });

    // Keep only last 200 points
    if (chartData.length > 200) {
      chartData = chartData.slice(-200);
    }

    chart!.updateData(chartData);
  }

  return {
    name: 'Wolf-Sheep Predation Model',
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
        background: #D2B48C;
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
      const world: World = {
        width: modelConfig.gridWidth,
        height: modelConfig.gridHeight,
      };
      model = new WolfSheepModel(world, modelConfig);
      model.setup();

      // Initialize environment view
      view = new EnvironmentView(envContainer, {
        throttleMs: 0,
      });

      gridStorage = new GridEnvStorage();
      const gridLayer = new GridLayer(view, gridStorage);
      gridLayer.setZIndex(15);
      view.addLayer(gridLayer);

      // Create two agent layers: one for grass, one for animals
      if (modelConfig.modelVersion === 'sheep-wolves-grass') {
        grassStorage = new AgentStorage();
        const grassLayer = new AgentLayer(view, grassStorage, {
          clickable: false,
          sceneBounds: { width: modelConfig.gridWidth, height: modelConfig.gridHeight },
        });
        grassLayer.setZIndex(10); // Grass at bottom
        view.addLayer(grassLayer);
        grassStorage.setAgents(initGrassAgents());
      }

      animalStorage = new AgentStorage();
      const animalLayer = new AgentLayer(view, animalStorage, {
        clickable: false,
        coordOffset: 'float',
        sceneBounds: { width: modelConfig.gridWidth, height: modelConfig.gridHeight },
      });
      animalLayer.setZIndex(20); // Animals on top
      view.addLayer(animalLayer);
      animalStorage.setAgents(convertAnimalsToRenderable());

      view.fitToScene({ padding: 0.05 });

      // Initialize chart
      chart = new LineChartView(chartContainer, {
        lines: [
          { key: 'sheep', name: 'Sheep', color: '#FFFFFF', strokeWidth: 2 },
          { key: 'wolves', name: 'Wolves', color: '#000000', strokeWidth: 2 },
          ...(modelConfig.modelVersion === 'sheep-wolves-grass'
            ? [{ key: 'grass', name: 'Grass', color: '#7EC850', strokeWidth: 2 }]
            : []),
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
      const canContinue = model!.go();

      // Update grass layer
      updateGrassAgents();

      // Update animal positions (full update for now, could be optimized)
      animalStorage!.setAgents(convertAnimalsToRenderable());

      // Update statistics chart
      updateStats();

      // Stop if model indicates end
      return canContinue;
    },

    teardown() {
      model?.destroy();
      view?.destroy();
      chart?.destroy();
      host?.remove();
      model = null;
      view = null;
      chart = null;
      grassStorage = null;
      animalStorage = null;
      gridStorage = null;
      host = null;
      chartData = [];
      timeStep = 0;
    },
  };
}

/**
 * Wolf-Sheep Model Variations
 */
export const wolfSheepVariations: CaseVariation = {
  name: 'WolfSheep',
  description: 'Wolf-Sheep Predation Model with varying world sizes and animal counts',
  cases: [
    // Small world, few animals
    createWolfSheepCase({
      gridWidth: 30,
      gridHeight: 30,
      initialNumberSheep: 50,
      initialNumberWolves: 25,
      sheepGainFromFood: 4,
      wolfGainFromFood: 20,
      grassRegrowthTime: 30,
      envWidth: 500,
      envHeight: 500,
    }),
    // Medium world, moderate animals
    createWolfSheepCase({
      gridWidth: 50,
      gridHeight: 50,
      initialNumberSheep: 400,
      initialNumberWolves: 150,
      sheepGainFromFood: 4,
      wolfGainFromFood: 20,
      grassRegrowthTime: 30,
      envWidth: 700,
      envHeight: 700,
    }),
    // Large world, many animals
    createWolfSheepCase({
      gridWidth: 100,
      gridHeight: 100,
      initialNumberSheep: 800,
      initialNumberWolves: 400,
      sheepGainFromFood: 4,
      wolfGainFromFood: 20,
      grassRegrowthTime: 25,
      envWidth: 900,
      envHeight: 900,
    }),
  ],
};
