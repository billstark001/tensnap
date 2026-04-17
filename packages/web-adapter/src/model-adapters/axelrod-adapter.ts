import type { Action, ChartGroupMetadata, GridAgent, Parameter } from '@tensnap/core';
import { AxelrodConfig, AxelrodState, countCultures, initializeAxelrod, stepAxelrod } from '../models/axelrod';
import { BaseModelAdapter } from './base-adapter';

const GRID_LAYER = 'grid';
const CULTURE_LAYER = 'culture';

export class AxelrodAdapter extends BaseModelAdapter {
  private state: AxelrodState;

  constructor(private readonly config: AxelrodConfig) {
    super({
      id: 'axelrod',
      name: 'Axelrod Cultural Dissemination',
      description: 'Local interaction drives convergence and global polarization of cultural traits.',
    });
    this.state = initializeAxelrod(config);
  }

  protected getParameters(): Parameter[] {
    return [
      { id: 'width', type: 'number', label: 'Grid Width', value: this.config.width, min: 10, max: 120, step: 1, allowRuntimeChange: false },
      { id: 'height', type: 'number', label: 'Grid Height', value: this.config.height, min: 10, max: 120, step: 1, allowRuntimeChange: false },
      { id: 'numFeatures', type: 'number', label: 'Feature Count', value: this.config.numFeatures, min: 2, max: 20, step: 1, allowRuntimeChange: false },
      { id: 'numTraits', type: 'number', label: 'Trait Count', value: this.config.numTraits, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    ];
  }

  protected getActions(): Action[] {
    return ['start', 'stop', 'step', 'reset', 'start_stop'].map((id) => ({
      id,
      label: id,
      allowRuntimeChange: true,
      continuous: id === 'start' || id === 'start_stop',
    }));
  }

  protected getEnvironments(): Array<{ id: string; type: 'uniform' | '2d' }> {
    return [{ id: 'main', type: '2d' }];
  }

  protected getCharts(): ChartGroupMetadata[] {
    return [
      { id: 'cultures', label: 'Culture Count', color: '#5f3dc4' },
      { id: 'updates', label: 'Successful Updates', color: '#087f5b' },
    ];
  }

  protected async handleParameterChange(): Promise<void> {
    // Runtime parameter changes are intentionally disabled for this adapter.
  }

  protected async handleActionStart(id: string, continuous?: boolean): Promise<void> {
    let shouldContinue = false;

    if (id === 'start') shouldContinue = await this.stepOnce();
    if (id === 'stop') shouldContinue = false;
    if (id === 'step') {
      await this.stepOnce();
      shouldContinue = false;
    }
    if (id === 'reset') {
      this.state = initializeAxelrod(this.config);
      await this.sendInitialData();
      shouldContinue = false;
    }
    if (id === 'start_stop') {
      shouldContinue = await this.stepOnce();
    }

    await this.sendActionEnd({
      id,
      continue: !!continuous && shouldContinue,
    });
  }

  protected async initialize(): Promise<void> {
    this.state = initializeAxelrod(this.config);
  }

  protected async cleanup(): Promise<void> {
    // no-op
  }

  protected async sendInitialData(): Promise<void> {
    await this.sendEnvLayerCreate({ env_id: 'main', layer_id: GRID_LAYER, layer_type: 'grid', data: { width: this.config.width, height: this.config.height } });
    await this.sendEnvLayerCreate({ env_id: 'main', layer_id: CULTURE_LAYER, layer_type: 'grid', data: { width: this.config.width, height: this.config.height } });
    await this.sendAgentCreate({ env_id: 'main', layer_id: GRID_LAYER, agents: this.createGridLayerAgents() });
    await this.sendAgentCreate({ env_id: 'main', layer_id: CULTURE_LAYER, agents: this.createCultureAgents() });
    await this.sendMetadataUpdate({ time: 0 });
    await this.sendChartUpdate({ updates: [
      { id: 'cultures', value: countCultures(this.state), time: 0 },
      { id: 'updates', value: this.state.totalUpdates, time: 0 },
    ] });
  }

  private createGridLayerAgents(): GridAgent[] {
    const cells: GridAgent[] = [];
    for (let r = 0; r < this.config.height; r++) {
      for (let c = 0; c < this.config.width; c++) {
        cells.push({
          id: `g_${r}_${c}`,
          x: c,
          y: r,
          heading: 0,
          icon: 'square',
          size: 1,
          color: (r + c) % 2 === 0 ? '#f8f9fa' : '#eef2f7',
        });
      }
    }
    return cells;
  }

  private createCultureAgents(): GridAgent[] {
    const max = Math.max(1, this.config.numTraits - 1);
    return this.state.agents.flat().map((agent) => {
      const [f0 = 0, f1 = 0, f2 = 0] = agent.features;
      const r = Math.round((f0 / max) * 255);
      const g = Math.round((f1 / max) * 255);
      const b = Math.round((f2 / max) * 255);
      const color = `rgb(${r}, ${g}, ${b})`;
      return {
        id: `a_${agent.row}_${agent.col}`,
        x: agent.col,
        y: agent.row,
        heading: 0,
        icon: 'square' as const,
        size: 0.92,
        color,
      };
    });
  }

  private async stepOnce(): Promise<boolean> {
    stepAxelrod(this.state);
    const time = this.state.totalUpdates;
    await this.sendMetadataUpdate({ time });

    const diff = this.createCultureAgents().map((a) => ({ id: a.id, x: a.x, y: a.y, icon: a.icon, size: a.size, color: a.color }));
    await this.sendAgentUpdate({ env_id: 'main', layer_id: CULTURE_LAYER, agents: diff });
    await this.sendChartUpdate({ updates: [
      { id: 'cultures', value: countCultures(this.state), time: this.state.totalUpdates },
      { id: 'updates', value: this.state.totalUpdates, time: this.state.totalUpdates },
    ] });
    return true;
  }
}

export function createAxelrodAdapter(config: Partial<AxelrodConfig> = {}): AxelrodAdapter {
  const defaults: AxelrodConfig = { width: 40, height: 40, numFeatures: 8, numTraits: 10 };
  return new AxelrodAdapter({ ...defaults, ...config });
}
