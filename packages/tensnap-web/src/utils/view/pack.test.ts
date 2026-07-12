import { describe, expect, it } from 'vitest';
import type { Action, BooleanParameter } from '@/types/model';
import type { AnyView, ContainerView } from '@/types/ui';
import type { ObjectWithChartMetadata, ObjectWithEnvironmentMetadata } from '@/components/view/types';
import { createDefaultRootLayout } from './create-view';
import { adjustForMainViewPadding, createAutoLayout } from './pack';
import { MAIN_VIEW_PADDING, preservedViewIds, viewConstants } from '@/components/view/constants';
import { getEffectiveViewBox } from './geometry';

describe('view pack utils', () => {
  it('adjusts root dimensions to cover all children with padding', () => {
    const view = createDefaultRootLayout([{
      id: 'button-1',
      type: 'button',
      left: 10.2,
      top: 20.4,
      width: 100.1,
      height: 40.3,
      expanded: true,
      disabled: false,
      data: { id: 'button-1', text: 'Button 1' },
    } as AnyView]);

    adjustForMainViewPadding(view);

    expect(Number.isInteger(view.width)).toBe(true);
    expect(Number.isInteger(view.height)).toBe(true);
    expect(view.width).toBeGreaterThan(110);
    expect(view.height).toBeGreaterThan(60);
  });

  it('uses collapsed container chrome height for effective geometry without mutating stored height', () => {
    const collapsedContainer = {
      id: 'collapsed-container',
      type: 'container',
      left: 20,
      top: 30,
      width: 200,
      height: 300,
      expanded: false,
      disabled: false,
      data: { title: 'Collapsed' },
      views: [],
    } as ContainerView;
    const view = createDefaultRootLayout([collapsedContainer]);

    const box = getEffectiveViewBox(collapsedContainer);
    adjustForMainViewPadding(view);

    expect(box.height).toBe(viewConstants.windowHeaderHeight);
    expect(collapsedContainer.height).toBe(300);
    expect(view.height).toBe(Math.ceil(30 + viewConstants.windowHeaderHeight + MAIN_VIEW_PADDING));
  });

  it('creates the expected containers and anchored views for new layouts', () => {
    const action = { id: 'run', label: 'Run' } as unknown as Action;
    const parameter = { id: 'toggle', label: 'Toggle', type: 'boolean' } as unknown as BooleanParameter;
    const environment = {
      id: 'env-1',
      type: '2d',
      label: 'Environment 1',
      width: 8,
      height: 6,
    } as ObjectWithEnvironmentMetadata;
    const chart = { id: 'chart-1', label: 'Chart 1' } as ObjectWithChartMetadata;

    const view = createAutoLayout(undefined, [environment], [parameter], [chart], {}, [action]);

    const buttonsContainer = view.views.find((item) => item.id === preservedViewIds.buttonsContainer) as ContainerView | undefined;
    const parametersContainer = view.views.find((item) => item.id === preservedViewIds.parametersContainer) as ContainerView | undefined;
    const environmentView = view.views.find((item) => item.id === 'environment-env-1');
    const chartView = view.views.find((item) => item.id === 'chart-chart-1');

    expect(buttonsContainer?.type).toBe('container');
    expect(parametersContainer?.type).toBe('container');
    expect(buttonsContainer?.views?.[0]?.id).toBe('button-run');
    expect(parametersContainer?.views?.[0]?.id).toBe('parameter-toggle');
    expect(environmentView?.type).toBe('environment');
    expect(chartView?.type).toBe('chart');
  });

  it('disables missing views instead of removing them when requested', () => {
    const currentView = createDefaultRootLayout([{
      id: 'button-orphan',
      type: 'button',
      left: 0,
      top: 0,
      width: 120,
      height: 40,
      expanded: true,
      disabled: false,
      data: { id: 'orphan', text: 'Orphan' },
    } as AnyView]);

    const updated = createAutoLayout(currentView, [], [], [], { disableMissingViews: true, inPlace: false });
    const orphanView = updated.views.find((item) => item.id === 'button-orphan');

    expect(orphanView?.disabled).toBe(true);
  });
});
