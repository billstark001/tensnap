import { useState } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { setupI18n } from '@lingui/core';
import { afterEach, expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core/scenario';
import type { AnchoredView } from '@tensnap/core/persistence';
import { EnvironmentViewEditor } from './EnvironmentViewEditor';
import { ChartViewEditor } from './ChartViewEditor';
import { MonitorViewEditor } from './MonitorViewEditor';
import { ParameterViewEditor } from './ParameterViewEditor';

const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
afterEach(cleanup);
const initial: AnchoredView = {
  id: 'view',
  type: 'environment',
  left: 0,
  top: 0,
  width: 300,
  height: 200,
  expanded: true,
  disabled: false,
  data: { id: 'world' },
};

it('keeps an empty numeric draft visible and prevents saving an earlier value by accident', () => {
  const change = vi.fn();
  render(
    <I18nProvider i18n={i18n}>
      <ParameterViewEditor
        view={{ ...initial, type: 'parameter' }}
        parameter={{ id: 'n', label: 'Number', type: 'number', value: 12 }}
        onChange={() => {}}
        onValueChange={change}
      />
    </I18nProvider>,
  );
  const input = screen.getByRole('spinbutton', { name: 'Value to apply on save' });
  fireEvent.change(input, { target: { value: '' } });
  expect(input).toHaveValue(null);
  expect(change).toHaveBeenLastCalledWith(NaN);
  fireEvent.change(input, { target: { value: '-2.5' } });
  expect(input).toHaveValue(-2.5);
  expect(change).toHaveBeenLastCalledWith(-2.5);
});

it('toggles every force with one switch, preserves zero and edits display type without modifying the environment', () => {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'world',
      layer_id: 'edges',
      layer_type: 'edge',
      metadata: { link_distance: 0 },
    },
  });
  const environment = scenario.getEnvironment('world')!;
  let saved = initial;
  function Editor() {
    const [view, setView] = useState(initial);
    return (
      <EnvironmentViewEditor
        view={view}
        environment={environment}
        onChange={(field, value) => {
          saved = { ...view, data: { ...view.data, [field.slice(5)]: value } };
          setView(saved);
        }}
      />
    );
  }
  render(
    <I18nProvider i18n={i18n}>
      <Editor />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('switch', { name: 'Force-directed layout' }));
  expect(saved.data.layerOverrides).toEqual({ edges: { link_distance: -1 } });
  fireEvent.click(screen.getByRole('switch', { name: 'Force-directed layout' }));
  expect(saved.data.layerOverrides).toEqual({ edges: { link_distance: 0 } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Display' }), {
    target: { value: 'uniform' },
  });
  expect(saved.data.type).toBe('uniform');
  expect(environment.type).toBe('2d');
  expect(environment.layers.get('edges')!.metadata).toEqual({ link_distance: 0 });
  expect(screen.queryByRole('checkbox')).toBeNull();
  const distance = screen.getByRole('spinbutton', { name: /^link_distance/ });
  fireEvent.change(distance, { target: { value: '' } });
  expect(distance).toHaveValue(null);
  fireEvent.change(distance, { target: { value: '-2.5' } });
  expect(distance).toHaveValue(-2.5);
  expect(saved.data.layerOverrides).toEqual({ edges: { link_distance: -2.5 } });
});

it('offers color pickers for both grid and trajectory overrides without changing declarations', () => {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  for (const layer_type of ['grid', 'trajectory'] as const)
    scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'world', layer_id: layer_type, layer_type },
    });
  const environment = scenario.getEnvironment('world')!;
  const change = vi.fn();
  render(
    <I18nProvider i18n={i18n}>
      <EnvironmentViewEditor view={initial} environment={environment} onChange={change} />
    </I18nProvider>,
  );
  const grid = screen.getByLabelText('Choose color: grid.stroke_color');
  const trajectory = screen.getByLabelText('Choose color: trajectory.color');
  expect(trajectory).toHaveValue('#4285f4');
  fireEvent.change(grid, { target: { value: '#123456' } });
  expect(change).toHaveBeenLastCalledWith('data.layerOverrides', {
    grid: { stroke_color: '#123456' },
  });
  fireEvent.change(trajectory, { target: { value: '#654321' } });
  expect(change).toHaveBeenLastCalledWith('data.layerOverrides', {
    trajectory: { color: '#654321' },
  });
  expect(environment.layers.get('grid')!.metadata.stroke_color).toBeUndefined();
  expect(environment.layers.get('trajectory')!.metadata.color).toBeUndefined();
});

it('keeps removed chart series data intact and can clear its local series preference', () => {
  const chart = {
    id: 'history',
    label: 'History',
    metadataDict: { a: { id: 'a', label: 'A', color: '#123456' } },
    data: [{ time: 1, a: 4 }],
  };
  let saved: AnchoredView = { ...initial, type: 'chart', data: { id: 'history' } };
  function Editor() {
    const [view, setView] = useState(saved);
    return (
      <ChartViewEditor
        view={view}
        chart={chart}
        onChange={(field, value) => {
          saved = { ...view, data: { ...view.data, [field.slice(5)]: value } };
          setView(saved);
        }}
      />
    );
  }
  render(
    <I18nProvider i18n={i18n}>
      <Editor />
    </I18nProvider>,
  );
  expect(screen.getByRole('textbox', { name: 'Series ID' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Choose color: A'), { target: { value: '#654321' } });
  expect(saved.data.chartSeries).toEqual([{ id: 'a', label: 'A', color: '#654321' }]);
  expect(chart.metadataDict.a.color).toBe('#123456');
  fireEvent.click(screen.getByRole('button', { name: 'Remove from view' }));
  expect(saved.data.chartSeries).toEqual([]);
  expect(chart.data).toEqual([{ time: 1, a: 4 }]);
  fireEvent.click(screen.getByRole('button', { name: 'Follow simulator' }));
  expect(saved.data.chartSeries).toBeUndefined();
});

it('can remove a monitor render override to follow current simulator advice', () => {
  let field: unknown, value: unknown;
  render(
    <I18nProvider i18n={i18n}>
      <MonitorViewEditor
        view={{ ...initial, type: 'monitor', data: { id: 'm', renderHint: 'text' } }}
        onChange={(key, next) => {
          field = key;
          value = next;
        }}
      />
    </I18nProvider>,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Display' }), { target: { value: '' } });
  expect(field).toBe('data.renderHint');
  expect(value).toBeUndefined();
});
