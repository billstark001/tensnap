import React, { useContext, useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/store/settings';
import { ViewContextMenuRenderer } from './ViewContextMenuRenderer';
import { EnvironmentViewportContext } from '../scenario/EnvironmentViewportContext';

const onButtonAction = vi.fn();
const deleteView = vi.fn();
const updateView = vi.fn();
const copyMonitorData = vi.fn();
const monitors = {
  getSnapshot: vi.fn(),
};
const scenarioState = {
  charts: null,
  scenario: { monitors, getEnvironment: () => ({ type: '2d' }) },
};

vi.mock('../view/useViewContext', () => ({
  useViewContext: () => ({
    onViewUpdate: vi.fn(),
    onButtonAction,
    isRunning: () => false,
  }),
}));

vi.mock('./view-edit-hooks', () => ({
  useUpdateAndDeleteView: () => ({ deleteView, updateView }),
}));

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof scenarioState) => unknown) => selector(scenarioState),
}));

vi.mock('@/store/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@tensnap/core/chart/browser', () => ({
  exportToCSV: vi.fn(),
}));

vi.mock('@lingui/react', () => ({
  Trans: ({
    children,
    message,
    id,
  }: {
    children?: React.ReactNode;
    message?: string;
    id?: string;
  }) => <>{children ?? message ?? id}</>,
  useLingui: () => ({
    _: (value: unknown) =>
      typeof value === 'string'
        ? value
        : ((value as { message?: string; id?: string }).message ??
          (value as { id?: string }).id ??
          ''),
  }),
}));

describe('ViewContextMenuRenderer', () => {
  it('places viewport reset below Copy and above the Edit separator, and invokes the mounted renderer', () => {
    const reset = vi.fn();
    function Environment() {
      const register = useContext(EnvironmentViewportContext)!;
      useEffect(() => register(reset), [register]);
      return <div>Environment canvas</div>;
    }
    render(
      <ViewContextMenuRenderer
        view={{
          id: 'view',
          type: 'environment',
          left: 0,
          top: 0,
          width: 200,
          height: 200,
          expanded: true,
          disabled: false,
          data: { id: 'env' },
        }}
        type="environment"
        dataType={null}
      >
        <div>
          <Environment />
        </div>
      </ViewContextMenuRenderer>,
    );
    fireEvent.contextMenu(screen.getByText('Environment canvas'));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Copy', 'Reset View', 'Edit', 'Delete']);
    const resetItem = screen.getByRole('menuitem', { name: 'Reset View' });
    expect(resetItem.nextElementSibling).toHaveAttribute('role', 'separator');
    fireEvent.click(resetItem);
    expect(reset).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    onButtonAction.mockReset();
    deleteView.mockReset();
    updateView.mockReset();
    copyMonitorData.mockReset();
    monitors.getSnapshot.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copyMonitorData },
    });
    useSettingsStore.setState({ continuousRunProfiles: {} });
  });

  it('keeps edit and delete while exposing bounded continuous execution from the context menu', () => {
    render(
      <ViewContextMenuRenderer
        view={{
          id: 'start-button',
          type: 'button',
          left: 0,
          top: 0,
          width: 120,
          height: 40,
          expanded: false,
          disabled: false,
          data: { id: 'start', text: 'Start', continuous: true },
        }}
        type="button"
        dataType={null}
      >
        <button type="button">Start</button>
      </ViewContextMenuRenderer>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Start' }));

    expect(screen.getByRole('menuitem', { name: 'Continuous run…' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Run one step' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Continuous run…' }));

    expect(screen.getByRole('dialog', { name: 'Continuous run' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start continuous run' }));

    expect(onButtonAction).toHaveBeenCalledWith('start', true, {
      maxSteps: 1000,
      stopWhen: undefined,
      maxWallTimeMs: undefined,
      record: false,
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Run one step' }));
    expect(onButtonAction).toHaveBeenLastCalledWith('start', false);
  });

  it('copies the latest monitor value as text without exposing chart export actions', async () => {
    monitors.getSnapshot.mockReturnValue({ value: { population: 12, active: true } });
    copyMonitorData.mockResolvedValue(undefined);

    render(
      <ViewContextMenuRenderer
        view={{
          id: 'population-monitor',
          type: 'monitor',
          left: 0,
          top: 0,
          width: 160,
          height: 100,
          expanded: false,
          disabled: false,
          data: { id: 'population', title: 'Population' },
        }}
        type="monitor"
        dataType={null}
      >
        <button type="button">Population</button>
      </ViewContextMenuRenderer>,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Population' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));

    await Promise.resolve();
    expect(monitors.getSnapshot).toHaveBeenCalledWith('population');
    expect(copyMonitorData).toHaveBeenCalledWith('{"population": 12, "active": true}');
    expect(screen.queryByRole('menuitem', { name: 'Save As CSV' })).not.toBeInTheDocument();
  });
});
