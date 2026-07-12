import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonViewComponent } from './ButtonViewComponent';

const onButtonAction = vi.fn();
const scenarioState: { session: any; runRevision: number; running: boolean } = { session: null, runRevision: 0, running: false };

vi.mock('./useViewContext', () => ({
  useViewContext: () => ({
    onButtonAction,
    isRunning: () => scenarioState.running,
  }),
}));

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof scenarioState) => unknown) => selector(scenarioState),
}));

describe('ButtonViewComponent', () => {
  beforeEach(() => {
    onButtonAction.mockReset();
    scenarioState.session = null;
    scenarioState.runRevision = 0;
    scenarioState.running = false;
  });

  it('switches to the play state as soon as one pause click is requested', () => {
    scenarioState.running = true;
    scenarioState.session = {
      run: {
        status: {
          state: 'running',
          pauseRequested: false,
          inFlight: true,
          spec: { mode: 'manual', actionId: 'start' },
          completedSteps: 3,
        },
      },
    };

    const { container, rerender } = render(
      <ButtonViewComponent
        view={{
          id: 'start-button', type: 'button', left: 0, top: 0, width: 120, height: 40,
          expanded: false, disabled: false, data: { id: 'start', text: 'Start', continuous: true },
        }}
      />,
    );

    fireEvent.click(screen.getByText('Start'));
    expect(onButtonAction).toHaveBeenCalledOnce();

    scenarioState.running = false;
    scenarioState.session.run.status.pauseRequested = true;
    scenarioState.runRevision += 1;
    rerender(
      <ButtonViewComponent
        view={{
          id: 'start-button', type: 'button', left: 0, top: 0, width: 120, height: 40,
          expanded: false, disabled: false, data: { id: 'start', text: 'Start', continuous: true },
        }}
      />,
    );

    expect(container.querySelector('.lucide-play')).toBeInTheDocument();
    expect(container.querySelector('.lucide-pause')).not.toBeInTheDocument();
    expect(screen.getByText('3 · Ⅱ')).toBeVisible();
    expect(screen.getByText('Start').parentElement).toHaveAttribute('title', '3 · paused');
  });

  it('starts a true manual run without a fake max-step profile', () => {
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

    expect(onButtonAction).toHaveBeenCalledWith('start', true);
  });

  it('keeps long stop reasons in the hover title and renders a compact glyph in the button', () => {
    scenarioState.session = {
      run: {
        status: {
          state: 'stopped',
          spec: { mode: 'manual', actionId: 'start' },
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
    const pause = vi.fn();
    scenarioState.session = {
      run: {
        status: {
          state: 'running',
          spec: { mode: 'manual', actionId: 'start' },
          completedSteps: 14,
        },
        pause,
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

    expect(pause).toHaveBeenCalledOnce();
    expect(screen.queryByText('14 ·')).not.toBeInTheDocument();
    expect(screen.getByText('Start').parentElement).not.toHaveAttribute('title');
  });
});
