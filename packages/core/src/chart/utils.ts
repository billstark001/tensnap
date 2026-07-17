import type { ChartGroupMetadata } from '@tensnap/protocol';
import type { ChartGroup } from './types';

export function instantiateChartMetadata(meta: ChartGroupMetadata): ChartGroup {
  const metadataDict = meta.data_list?.length
    ? Object.fromEntries(meta.data_list.map(m => [m.id, m]))
    : { [meta.id]: meta };

  return {
    id: meta.id,
    label: meta.label,
    metadataDict,
    data: [],
  };
}

export function createCsvContent(chartGroup: ChartGroup): string {
  const { metadataDict, data } = chartGroup;
  const chartIds = Object.keys(metadataDict);

  const header = ['time', ...chartIds].join(',');
  const rows = data.map(dp =>
    [dp.time, ...chartIds.map(id => dp[id] ?? '')].join(',')
  );

  return [header, ...rows].join('\n');
}
