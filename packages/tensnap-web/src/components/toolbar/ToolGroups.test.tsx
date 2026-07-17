import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SimulationControlTools } from './ToolGroups';
import { resolveToolbarActionIds } from './toolbar-action-model';

const startManualRun = vi.fn();
const pauseRun = vi.fn();
const requestStep = vi.fn();
const requestReset = vi.fn();
const controlsState = {
  runStatus: null as any,
  isSnapshotSource: false,
  isSnapshotPlaying: false,
  startManualRun,
  startBoundedRun: vi.fn(),
  pauseRun,
  requestStep,
  requestReset,
  requestModelAction: vi.fn(),
};
const scenarioState = {
  actions: new Map([
    ['start', { id: 'start', label: 'Start', continuous: true }],
    ['step', { id: 'step', label: 'Step' }],
    ['reset', { id: 'reset', label: 'Reset' }],
  ]),
  connected: true,
  actionRevision: 0,
  stopRecording: vi.fn(),
};

vi.mock('../../hooks/useButtonControls', () => ({
  useButtonControls: () => controlsState,
  isActionVisiblyRunning: (status: { state?: string; pauseRequested?: boolean; spec?: { actionId?: string } } | null, actionId: string) => (
    status?.state === 'running'
    && !status.pauseRequested
    && status.spec?.actionId === actionId
  ),
}));

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof scenarioState) => unknown) => selector(scenarioState),
}));

vi.mock('./useFileOperations', () => ({
  useFileOperations: () => ({
    canSaveFile: false,
    onNewFile: vi.fn(),
    onFileOpen: vi.fn(),
    onFileSave: vi.fn(),
  }),
}));

vi.mock('@/dialogs/AboutDialog', () => ({
  AboutDialog: () => null,
}));

vi.mock('@lingui/react', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useLingui: () => ({
    _: (value: unknown) => typeof value === 'string'
      ? value
      : (value as { message?: string; id?: string }).message ?? (value as { id?: string }).id ?? '',
  }),
}));

describe('SimulationControlTools', () => {
  beforeEach(() => {
    startManualRun.mockReset();
    pauseRun.mockReset();
    controlsState.runStatus = null;
    controlsState.isSnapshotSource = false;
    controlsState.isSnapshotPlaying = false;
  });

  it('starts the toolbar action as an explicit manual persistent run', () => {
    render(
      <Tooltip.Provider>
        <SimulationControlTools />
      </Tooltip.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(startManualRun).toHaveBeenCalledWith('start');
  });

  it('shows a pending pause as non-running and blocks another control click until its tick completes', () => {
    controlsState.runStatus = {
      id: 'run-1',
      state: 'running',
      pauseRequested: true,
      inFlight: true,
      completedSteps: 4,
      startedAt: 0,
      spec: { mode: 'manual', actionId: 'start' },
    };

    render(
      <Tooltip.Provider>
        <SimulationControlTools />
      </Tooltip.Provider>,
    );

    const control = screen.getByRole('button', { name: 'Waiting for current tick' });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(pauseRun).not.toHaveBeenCalled();
    expect(startManualRun).not.toHaveBeenCalled();
  });

  it('falls back to step and excludes actions that need a target or required arguments', () => {
    const actions = new Map([
      ['start', { id: 'start', label: 'Start', scope: 'agent' as const, continuous: true }],
      ['step', { id: 'step', label: 'Step', continuous: true }],
      ['reset', { id: 'reset', label: 'Reset', kwargs: [{ name: 'seed', type: 'integer' as const, required: true }] }],
    ]);

    expect(resolveToolbarActionIds(actions)).toEqual({
      runActionId: 'step',
      stepActionId: 'step',
      resetActionId: undefined,
    });
  });
});
