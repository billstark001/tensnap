import { ChartGroup } from './types';
import { createCsvContent } from './utils';

const DOWNLOAD_URL_LIFETIME_MS = 1_000;

/** Download a chart group as CSV, keeping the object URL alive for the browser. */
export function exportToCSV(chartGroup: ChartGroup) {
  const csvContent = createCsvContent(chartGroup);
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `chart_${chartGroup.id}_${Date.now()}.csv`;
  try {
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
  }
}
