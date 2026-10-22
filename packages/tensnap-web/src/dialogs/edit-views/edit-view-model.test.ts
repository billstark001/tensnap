import { expect, it } from 'vitest';
import type { AnchoredView } from '@tensnap/core/persistence';
import { applyViewEdit } from './edit-view-model';

const view: AnchoredView = {
  id: 'view-1',
  type: 'chart',
  left: 0,
  top: 0,
  width: 300,
  height: 200,
  disabled: false,
  expanded: true,
  data: { id: 'chart-1', title: 'Chart' },
};

it('changes only the view binding and preserves concurrent geometry changes', () => {
  const edited = structuredClone(view);
  edited.data.id = 'chart-2';
  edited.data.chartSeries = [{ id: 'local', label: 'Local' }];
  const current = { ...structuredClone(view), width: 500 };
  expect(applyViewEdit(current, view, edited)).toEqual({ ...edited, width: 500 });
  expect(current.data.id).toBe('chart-1');
});

it('clears an inherited preference and detects conflicting edits', () => {
  const baseline = structuredClone(view);
  baseline.data.chartSeries = [{ id: 'a', label: 'A' }];
  expect(applyViewEdit(baseline, baseline, view).data).not.toHaveProperty('chartSeries');
  expect(() => applyViewEdit({ ...view, width: 400 }, view, { ...view, width: 500 })).toThrow(
    'changed while editing',
  );
});
