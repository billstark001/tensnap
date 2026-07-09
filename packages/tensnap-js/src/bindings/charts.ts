import type { ChartGroupMetadata } from '@tensnap/protocol';
import type { ChartBinding, ChartOptions, ChartSeriesOptions } from './types';
import { titleFromId, withDefined } from './utils';

export function chartBinding<TConfig extends object, TModel>(
  id: string,
  options: ChartOptions<TConfig, TModel>,
): ChartBinding<TConfig, TModel> {
  return {
    metadata() {
      return withDefined({
        id,
        label: options.label ?? titleFromId(id),
        color: options.color,
      }) as ChartGroupMetadata;
    },
    values(model, config) {
      return { [id]: options.get(model, config) };
    },
  };
}

export function chartGroupBinding<TConfig extends object, TModel>(
  id: string,
  options: {
    label?: string;
    color?: string;
    series: readonly ChartSeriesOptions<TConfig, TModel>[];
  },
): ChartBinding<TConfig, TModel> {
  return {
    metadata() {
      return withDefined({
        id,
        label: options.label ?? titleFromId(id),
        color: options.color,
        dataList: options.series.map((series) => withDefined({
          id: series.id,
          label: series.label ?? titleFromId(series.id),
          color: series.color,
        })),
      }) as ChartGroupMetadata;
    },
    values(model, config) {
      return Object.fromEntries(
        options.series.map((series) => [series.id, series.get(model, config)]),
      );
    },
  };
}
