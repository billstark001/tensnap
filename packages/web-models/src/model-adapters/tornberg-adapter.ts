import type { Action, ChartGroupMetadata, GridAgent, Parameter } from '@tensnap/core';
import {
  TornbergConfig,
  TornbergState,
  computeSorting,
  initializeTornberg,
  stepTornberg,
} from '../models/tornberg';
import { BaseModelAdapter } from './base-adapter';

const PARTISAN_LAYER = 'partisan';
const SORTING_SAMPLE_INTERVAL = 10;

export class TornbergAdapter extends BaseModelAdapter {
  private state: TornbergState;
  private stepCount = 0;
  private lastSorting = 0;

  constructor(private readonly config: TornbergConfig) {
    super({
      id: 'tornberg',
      name: 'Tornberg Partisan Sorting',
      description: 'Digital-media reach and homophily amplify partisan sorting in cultural space.',
    });
    this.state = initializeTornberg(config);
  }

  protected getParameters(): Parameter[] {
    return [
      { id: 'width', type: 'number', label: 'Grid Width', value: this.config.width, min: 10, max: 120, step: 1, allowRuntimeChange: false },
      { id: 'height', type: 'number', label: 'Grid Height', value: this.config.height, min: 10, max: 120, step: 1, allowRuntimeChange: false },
      { id: 'numFeatures', type: 'number', label: 'Feature Count', value: this.config.numFeatures, min: 2, max: 20, step: 1, allowRuntimeChange: false },
      { id: 'numTraits', type: 'number', label: 'Trait Count', value: this.config.numTraits, min: 2, max: 20, step: 1, allowRuntimeChange: false },
      { id: 'numPartisans', type: 'number', label: 'Partisans', value: this.config.numPartisans, min: 2, max: 6, step: 1, allowRuntimeChange: false },
      { id: 'partisanWeight', type: 'number', label: 'Partisan Weight', value: this.config.partisanWeight, min: 1, max: 20, step: 1, allowRuntimeChange: false },
      { id: 'gamma', type: 'number', label: 'Gamma', value: this.config.gamma, min: 0, max: 1, step: 0.05, allowRuntimeChange: false },
      { id: 'homophilyH', type: 'number', label: 'Homophily Exponent', value: this.config.homophilyH, min: 1, max: 12, step: 1, allowRuntimeChange: false },
    ];
  }

  protected getActions(): Action[] {
    return ['start', 'step', 'reset'].map((id) => ({
      id,
      label: id,
      allowRuntimeChange: true,
      continuous: id === 'start',
    }));
  }

  protected getEnvironments(): Array<{ id: string; type: 'uniform' | '2d' }> {
    return [{ id: 'main', type: '2d' }];
  }

  protected getCharts(): ChartGroupMetadata[] {
    return [
      { id: 'sorting', label: 'Sorting Psi', color: '#c92a2a' },
      { id: 'updates', label: 'Updates', color: '#1971c2' },
    ];
  }

  protected async handleParameterChange(): Promise<void> {
    // Runtime parameter changes are intentionally disabled for this adapter.
  }

  protected async handleActionStart(id: string, continuous?: boolean): Promise<void> {
    let shouldContinue = false;

    if (id === 'start') shouldContinue = await this.stepOnce();
    if (id === 'step') {
      await this.stepOnce();
      shouldContinue = false;
    }
    if (id === 'reset') {
      this.state = initializeTornberg(this.config);
      this.stepCount = 0;
      this.lastSorting = computeSorting(this.state);
      await this.sendInitialData();
      shouldContinue = false;
    }

    await this.sendActionEnd({
      id,
      continue: !!continuous && shouldContinue,
    });
  }

  protected async initialize(): Promise<void> {
    this.state = initializeTornberg(this.config);
    this.stepCount = 0;
    this.lastSorting = computeSorting(this.state);
  }

  protected async cleanup(): Promise<void> {
    // no-op
  }

  protected async sendInitialData(): Promise<void> {
    await this.sendEnvLayerCreate({ env_id: 'main', layer_id: PARTISAN_LAYER, layer_type: 'agent', data: { width: this.config.width, height: this.config.height } });
    await this.sendItemCreate({ env_id: 'main', layer_id: PARTISAN_LAYER, items: this.createPartisanAgents() });
    await this.sendMetadataUpdate({ time: 0 });
    await this.sendChartUpdate({ updates: [
      { id: 'sorting', value: this.lastSorting, time: 0 },
      { id: 'updates', value: this.state.totalUpdates, time: 0 },
    ] });
  }

  private createPartisanAgents(): GridAgent[] {
    const palette = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0b7285'];
    return this.state.agents.flat().map((agent) => {
      const partisanColor = palette[agent.partisan % palette.length];
      return {
        id: `t_${agent.row}_${agent.col}`,
        x: agent.col,
        y: agent.row,
        heading: 0,
        icon: 'square' as const,
        size: 0.92,
        color: partisanColor,
      } as GridAgent;
    });
  }

  private async stepOnce(): Promise<boolean> {
    stepTornberg(this.state);
    this.stepCount += 1;
    const time = this.stepCount;

    if (time % SORTING_SAMPLE_INTERVAL === 0) {
      this.lastSorting = computeSorting(this.state);
    }

    await this.sendMetadataUpdate({ time });
    const updates = this.createPartisanAgents().map((a) => ({ id: a.id, x: a.x, y: a.y, color: a.color, icon: a.icon, size: a.size }));
    await this.sendItemUpdate({ env_id: 'main', layer_id: PARTISAN_LAYER, items: updates });
    await this.sendChartUpdate({ updates: [
      { id: 'sorting', value: this.lastSorting, time },
      { id: 'updates', value: this.state.totalUpdates, time },
    ] });
    return true;
  }
}

export function createTornbergAdapter(config: Partial<TornbergConfig> = {}): TornbergAdapter {
  const defaults: TornbergConfig = {
    width: 30,
    height: 30,
    numFeatures: 10,
    numTraits: 10,
    numPartisans: 2,
    partisanWeight: 4,
    gamma: 0.25,
    homophilyH: 4,
  };
  return new TornbergAdapter({ ...defaults, ...config });
}
