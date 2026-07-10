import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonViewComponent } from './ButtonViewComponent';
import { MAX_INT32_RUN_STEPS } from '@tensnap/core/runtime';

const onButtonAction = vi.fn();
const scenarioState: { session: any; _revision: number } = { session: null, _revision: 0 };

vi.mock('./useViewContext', () => ({
  useViewContext: () => ({
    onButtonAction,
    isRunning: () => false,
  }),
}));

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof scenarioState) => unknown) => selector(scenarioState),
}));

describe('ButtonViewComponent', () => {
  beforeEach(() => {
    onButtonAction.mockReset();
    scenarioState.session = null;
    scenarioState._revision = 0;
  });

  it('keeps primary click as the legacy run-until-stopped action dispatch', () => {
    render(
      <ButtonViewComponent
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
      />,
    );

    fireEvent.click(screen.getByText('Start'));

    expect(onButtonAction).toHaveBeenCalledWith('start', true, {
      maxSteps: MAX_INT32_RUN_STEPS,
      record: false,
    });
  });

  it('keeps long stop reasons in the hover title and renders a compact glyph in the button', () => {
    scenarioState.session = {
      run: {
        status: {
          state: 'stopped',
          spec: { actionId: 'start', maxSteps: MAX_INT32_RUN_STEPS },
          completedSteps: 14,
          stopReason: 'simulator',
        },
      },
    };

    render(
      <ButtonViewComponent
        view={{
          id: 'start-button', type: 'button', left: 0, top: 0, width: 120, height: 40,
          expanded: false, disabled: false, data: { id: 'start', text: 'Start', continuous: true },
        }}
      />,
    );

    expect(screen.queryByText('simulator')).not.toBeInTheDocument();
    expect(screen.getByText('14 · ■')).toBeVisible();
    expect(screen.getByText('Start').parentElement).toHaveAttribute('title', '14 · simulator');
  });

  it('clears and stops an active run when the button is changed to one-step mode', () => {
    const stop = vi.fn();
    scenarioState.session = {
      run: {
        status: {
          state: 'running',
          spec: { actionId: 'start', maxSteps: MAX_INT32_RUN_STEPS },
          completedSteps: 14,
        },
        stop,
      },
    };

    render(
      <ButtonViewComponent
        view={{
          id: 'start-button', type: 'button', left: 0, top: 0, width: 120, height: 40,
          expanded: false, disabled: false, data: { id: 'start', text: 'Start' },
        }}
      />,
    );

    expect(stop).toHaveBeenCalledOnce();
    expect(screen.queryByText('14 ·')).not.toBeInTheDocument();
    expect(screen.getByText('Start').parentElement).not.toHaveAttribute('title');
  });
});
