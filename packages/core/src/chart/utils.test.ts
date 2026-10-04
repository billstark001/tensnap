import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportToCSV } from './browser-utils';
import { createCsvContent } from './utils';
import type { ChartGroup } from './types';

const chart: ChartGroup = {
  id: 'chart',
  label: 'Chart',
  metadataDict: { 'a,b': { id: 'a,b', label: 'A, B' }, note: { id: 'note', label: 'Note' } },
  data: [{ time: 1, 'a,b': 'x,"y"', note: 'line 1\nline 2' }, { time: 2, 'a,b': null }],
};

describe('chart CSV export', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('quotes delimiter characters and leaves missing cells empty', () => {
    expect(createCsvContent(chart)).toBe('time,"a,b",note\n1,"x,""y""","line 1\nline 2"\n2,,');
  });

  it('releases the download URL after the click has had time to start', () => {
    vi.useFakeTimers();
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:chart');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    exportToCSV(chart);
    expect(createUrl).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeUrl).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeUrl).toHaveBeenCalledWith('blob:chart');
  });
});
