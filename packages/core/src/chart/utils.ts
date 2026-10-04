import type { ChartGroupMetadata } from '@tensnap/protocol';
import type { ChartGroup } from './types';

export function instantiateChartMetadata(meta: ChartGroupMetadata): ChartGroup {
  const metadataDict = meta.data_list?.length
    ? Object.fromEntries(meta.data_list.map((m) => [m.id, m]))
    : { [meta.id]: meta };

  return {
    id: meta.id,
    label: meta.label,
    metadataDict,
    data: [],
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serialize chart rows as CSV, quoting delimiters in labels and values. */
export function createCsvContent(chartGroup: ChartGroup): string {
  const { metadataDict, data } = chartGroup;
  const chartIds = Object.keys(metadataDict);

  const header = ['time', ...chartIds].map(csvCell).join(',');
  const rows = data.map((dp) => [dp.time, ...chartIds.map((id) => dp[id])].map(csvCell).join(','));

  return [header, ...rows].join('\n');
}
