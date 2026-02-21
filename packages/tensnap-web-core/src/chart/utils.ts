import { ChartGroup, ChartGroupMetadata } from "./types";

export function instantiateChartMetadata(meta: ChartGroupMetadata): ChartGroup {
  const metadataDict = meta.dataList?.length
    ? Object.fromEntries(meta.dataList.map(m => [m.id, m]))
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

export function exportToCSV(chartGroup: ChartGroup) {
  const csvContent = createCsvContent(chartGroup);
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chart_${chartGroup.id}_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
