// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnchoredViewRenderer } from './AnchoredViewRenderer';

const mockState = {
  environments: new Map(),
  environmentUpdateTrigger: { value: 0 },
  parameters: new Map(),
  charts: { getGroup: vi.fn() },
  _revision: 0,
};

vi.mock('../../store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

vi.mock('../scenario/Environment2DView', () => ({
  Environment2DView: ({ environment }: { environment: { id: string } }) => <div data-testid="environment-2d">{environment.id}</div>,
}));

vi.mock('../scenario/UniformEnvironmentView', () => ({
  UniformEnvironmentView: ({ environment }: { environment: { id: string } }) => <div data-testid="environment-uniform">{environment.id}</div>,
}));

vi.mock('./ParameterControl', () => ({
  ParameterControl: () => <div data-testid="parameter-view" />,
}));

vi.mock('../scenario/ChartView', () => ({
  ChartView: () => <div data-testid="chart-view" />,
}));

vi.mock('../view/ViewErrorBoundary', () => ({
  ViewErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/store/toast', () => ({
  useToast: () => ({ warning: vi.fn() }),
}));

describe('AnchoredViewRenderer', () => {
  beforeEach(() => {
    mockState.environments = new Map();
    mockState.environmentUpdateTrigger = { value: 0 };
  });

  it('routes 2d environments to Environment2DView', () => {
    mockState.environments.set('env-2d', { id: 'env-2d', type: '2d', layers: new Map() });

    render(
      <AnchoredViewRenderer
        type="environment"
        id="env-2d"
        view={{ id: 'view-1', type: 'environment', data: { id: 'env-2d', type: '2d' } } as any}
      />,
    );

    expect(screen.getByTestId('environment-2d')).toHaveTextContent('env-2d');
  });

  it('routes uniform environments to UniformEnvironmentView', () => {
    mockState.environments.set('env-uniform', { id: 'env-uniform', type: 'uniform', layers: new Map() });

    render(
      <AnchoredViewRenderer
        type="environment"
        id="env-uniform"
        view={{ id: 'view-2', type: 'environment', data: { id: 'env-uniform', type: 'uniform' } } as any}
      />,
    );

    expect(screen.getByTestId('environment-uniform')).toHaveTextContent('env-uniform');
  });

  it('renders chart views', () => {
    mockState.charts.getGroup.mockReturnValue({ id: 'chart-1', metadataDict: {}, data: [] });

    render(
      <AnchoredViewRenderer
        type="chart"
        id="chart-1"
        view={{ id: 'view-3', type: 'chart', data: { id: 'chart-1' } } as any}
      />,
    );

    expect(screen.getByTestId('chart-view')).toBeInTheDocument();
  });
});