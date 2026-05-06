import { ChartGroup } from './types';
import { createCsvContent } from './utils';

export function exportToCSV(chartGroup: ChartGroup) {
  const csvContent = createCsvContent(chartGroup);
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chart_${chartGroup.id}_${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}