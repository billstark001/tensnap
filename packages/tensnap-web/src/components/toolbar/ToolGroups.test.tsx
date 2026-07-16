import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SimulationControlTools } from './ToolGroups';
import { resolveToolbarActionIds } from './toolbar-action-model';

const startManualRun = vi.fn();
const pauseRun = vi.fn();
const requestStep = vi.fn();
const requestReset = vi.fn();
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
  useButtonControls: () => ({
    runStatus: null,
    startManualRun,
    startBoundedRun: vi.fn(),
    pauseRun,
    requestStep,
    requestReset,
  }),
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
