import type { Action, ChartGroupMetadata, Parameter } from '@tensnap/core';
import { SchellingConfig, SchellingModel } from '../models/schelling';
import { BaseModelAdapter } from './base-adapter';

const AGENT_LAYER = 'agents';

export class SchellingAdapter extends BaseModelAdapter {
  private model: SchellingModel;

  constructor(config: SchellingConfig) {
    super({
      id: 'schelling',
      name: 'Schelling Segregation Model',
      description: 'Local similarity preference causes macro segregation patterns.',
    });
    this.model = new SchellingModel(config);
  }

  protected getParameters(): Parameter[] {
    const config = this.model.getConfig();
    return [
      { id: 'similarityThreshold', type: 'number', label: 'Similarity Threshold', value: config.similarityThreshold, min: 0, max: 1, step: 0.05, allowRuntimeChange: true },
      { id: 'moveDistance', type: 'number', label: 'Move Distance', value: config.moveDistance, min: 1, max: 10, step: 1, allowRuntimeChange: true },
      { id: 'gridWidth', type: 'number', label: 'Grid Width', value: config.gridWidth, min: 10, max: 100, step: 1, allowRuntimeChange: false },
      { id: 'gridHeight', type: 'number', label: 'Grid Height', value: config.gridHeight, min: 10, max: 100, step: 1, allowRuntimeChange: false },
      { id: 'numAgentsType1', type: 'number', label: 'Type 1 Count', value: config.numAgentsType1, min: 10, max: 1000, step: 10, allowRuntimeChange: false },
      { id: 'numAgentsType2', type: 'number', label: 'Type 2 Count', value: config.numAgentsType2, min: 10, max: 1000, step: 10, allowRuntimeChange: false },
    ];
  }

  protected getActions(): Action[] {
    return ['start', 'step', 'reset'].map((id) => {
      const continuous = id === 'start';
      return {
        id,
        label: id.split('_').map((w) => `${w[0].toUpperCase()}${w.slice(1)}`).join('/'),
        allowRuntimeChange: true,
        continuous,
      };
    });
  }

  protected getEnvironments(): Array<{ id: string; type: 'uniform' | '2d' }> {
    return [{ id: 'main', type: '2d' }];
  }

  protected getCharts(): ChartGroupMetadata[] {
    return [
      { id: 'satisfaction_rate', label: 'Satisfaction Rate', color: '#2f9e44' },
      { id: 'segregation_index', label: 'Segregation Index', color: '#e8590c' },
    ];
  }

  protected async handleParameterChange(id: string, value: unknown): Promise<void> {
    this.model.updateParameter(id, value);
  }

  protected async handleActionStart(id: string, continuous?: boolean): Promise<void> {
    let shouldContinue = false;

    if (id === 'start') shouldContinue = await this.stepOnce();
    if (id === 'step') {
      await this.stepOnce();
      shouldContinue = false;
    }
    if (id === 'reset') {
      this.model.reset();
      await this.sendInitialData();
      await this.sendChartUpdate({ operations: [
        { id: 'satisfaction_rate', operation: 'clear' },
        { id: 'segregation_index', operation: 'clear' },
      ] });
      shouldContinue = false;
    }

    await this.sendActionEnd({
      id,
      continue: !!continuous && shouldContinue,
    });
  }

  protected async initialize(): Promise<void> {
    this.model.initialize();
  }

  protected async cleanup(): Promise<void> {
    this.model.destroy();
  }

  protected async sendInitialData(): Promise<void> {
    const config = this.model.getConfig();
    await this.sendEnvLayerCreate({ env_id: 'main', layer_id: AGENT_LAYER, layer_type: 'grid', data: { width: config.gridWidth, height: config.gridHeight } });

    const allAgents = this.model.getEnvironmentState().agents;
    await this.sendAgentCreate({ env_id: 'main', layer_id: AGENT_LAYER, agents: allAgents });

    const stats = this.model.getStatistics();
    await this.sendMetadataUpdate({ time: 0 });
    await this.sendChartUpdate({ updates: [
      { id: 'satisfaction_rate', value: stats.satisfactionRate, time: 0 },
      { id: 'segregation_index', value: stats.segregationIndex, time: 0 },
    ] });
  }

  private async stepOnce(): Promise<boolean> {
    this.model.step();
    const stats = this.model.getStatistics();
    await this.sendMetadataUpdate({ time: stats.timeStep });

    const updates = this.model.getAgentUpdates(false);
    const create = updates.filter((x) => x.operation === 'create').map((x) => x.data);
    const change = updates.filter((x) => x.operation === 'update').map((x) => x.data);
    if (create.length > 0) {
      await this.sendAgentCreate({ env_id: 'main', layer_id: AGENT_LAYER, agents: create });
    }
    if (change.length > 0) {
      await this.sendAgentUpdate({ env_id: 'main', layer_id: AGENT_LAYER, agents: change });
    }

    await this.sendChartUpdate({ updates: [
      { id: 'satisfaction_rate', value: stats.satisfactionRate, time: stats.timeStep },
      { id: 'segregation_index', value: stats.segregationIndex, time: stats.timeStep },
    ] });
    return true;
  }
}

export function createSchellingAdapter(config: Partial<SchellingConfig> = {}): SchellingAdapter {
  const defaults: SchellingConfig = {
    gridWidth: 50,
    gridHeight: 50,
    numAgentsType1: 600,
    numAgentsType2: 600,
    similarityThreshold: 0.4,
    moveDistance: 10,
  };
  return new SchellingAdapter({ ...defaults, ...config });
}
