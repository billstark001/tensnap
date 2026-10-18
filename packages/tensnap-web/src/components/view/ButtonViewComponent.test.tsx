import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonViewComponent } from './ButtonViewComponent';

const onButtonAction = vi.fn();
const scenarioState: {
  session: any;
  runRevision: number;
  actionRevision: number;
  running: boolean;
  actions: Map<string, any>;
} = {
  session: null,
  runRevision: 0,
  actionRevision: 0,
  running: false,
  actions: new Map([['start', { id: 'start', label: 'Start' }]]),
};

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
    scenarioState.actionRevision = 0;
    scenarioState.running = false;
    scenarioState.actions = new Map([['start', { id: 'start', label: 'Start' }]]);
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
          completedActions: 3,
          succeededActions: 3,
          failedActions: 0,
          settled: false,
        },
      },
    };

    const { container, rerender } = render(
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
    expect(onButtonAction).toHaveBeenCalledOnce();

    scenarioState.running = false;
    scenarioState.session.run.status.pauseRequested = true;
    scenarioState.runRevision += 1;
    rerender(
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

    expect(container.querySelector('.lucide-play')).toBeInTheDocument();
    expect(container.querySelector('.lucide-pause')).not.toBeInTheDocument();
    expect(screen.getByText('3 · Ⅱ')).toBeVisible();
    expect(screen.getByText('Start').parentElement).toHaveAttribute(
      'title',
      '3 · paused · ✓3 ×0 · …',
    );
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
          completedActions: 14,
          succeededActions: 14,
          failedActions: 0,
          settled: true,
          stopReason: 'simulator',
        },
      },
    };

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

    expect(screen.queryByText('simulator')).not.toBeInTheDocument();
    expect(screen.getByText('14 · ■')).toBeVisible();
    expect(screen.getByText('Start').parentElement).toHaveAttribute(
      'title',
      '14 · simulator · ✓14 ×0',
    );
  });

  it('clears and stops an active run when the button is changed to one-step mode', () => {
    const pause = vi.fn();
    scenarioState.session = {
      run: {
        status: {
          state: 'running',
          spec: { mode: 'manual', actionId: 'start' },
          completedActions: 14,
          succeededActions: 14,
          failedActions: 0,
          settled: true,
        },
        pause,
      },
    };

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
          data: { id: 'start', text: 'Start' },
        }}
      />,
    );

    expect(pause).toHaveBeenCalledOnce();
    expect(screen.queryByText('14 ·')).not.toBeInTheDocument();
    expect(screen.getByText('Start').parentElement).not.toHaveAttribute('title');
  });

  it('does not invoke actions that need a target or required arguments', () => {
    scenarioState.actions = new Map([
      ['agent-action', { id: 'agent-action', label: 'Agent action', scope: 'agent' }],
      [
        'seed',
        { id: 'seed', label: 'Seed', kwargs: [{ name: 'value', type: 'number', required: true }] },
      ],
    ]);

    const { rerender } = render(
      <ButtonViewComponent
        view={{
          id: 'agent-button',
          type: 'button',
          left: 0,
          top: 0,
          width: 120,
          height: 40,
          expanded: false,
          disabled: false,
          data: { id: 'agent-action', text: 'Agent action' },
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Agent action' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Agent action' }));
    expect(onButtonAction).not.toHaveBeenCalled();

    rerender(
      <ButtonViewComponent
        view={{
          id: 'seed-button',
          type: 'button',
          left: 0,
          top: 0,
          width: 120,
          height: 40,
          expanded: false,
          disabled: false,
          data: { id: 'seed', text: 'Seed' },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Seed' })).toBeDisabled();
  });
});

it('keeps an action failure visible while pause was also requested', () => {
  scenarioState.session = {
    run: {
      status: {
        state: 'paused',
        pauseRequested: true,
        spec: { mode: 'manual', actionId: 'start' },
        completedActions: 1,
        succeededActions: 0,
        failedActions: 1,
        settled: true,
        primaryFailure: 'action-error',
        stopReason: 'action-error',
      },
    },
  };
  render(
    <ButtonViewComponent
      view={{
        id: 'start',
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
  expect(screen.getByText('Start').parentElement).toHaveAttribute(
    'title',
    '1 · action-error · ✓0 ×1',
  );
});
