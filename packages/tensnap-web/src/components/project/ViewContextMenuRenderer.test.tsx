import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/store/settings';
import { ViewContextMenuRenderer } from './ViewContextMenuRenderer';

const onButtonAction = vi.fn();
const deleteView = vi.fn();
const updateView = vi.fn();
const copyMonitorData = vi.fn();
const monitors = {
  getSnapshot: vi.fn(),
};
const scenarioState = {
  charts: null,
  scenario: { monitors },
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
  Trans: ({ children, message, id }: { children?: React.ReactNode; message?: string; id?: string }) => <>{children ?? message ?? id}</>,
  useLingui: () => ({
    _: (value: unknown) => typeof value === 'string'
      ? value
      : (value as { message?: string; id?: string }).message ?? (value as { id?: string }).id ?? '',
  }),
}));

describe('ViewContextMenuRenderer', () => {
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

    expect(screen.getByRole('dialog')).toHaveTextContent('Continuous run');
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
