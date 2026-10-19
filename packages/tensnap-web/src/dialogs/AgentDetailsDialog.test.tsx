// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const rendererHarness = vi.hoisted(() => {
  const instances: Array<{
    render: ReturnType<typeof vi.fn>;
    setViewport: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    instances,
    reset: () => {
      instances.length = 0;
    },
  };
});

vi.mock('@lingui/react', async () => {
  const actual = await vi.importActual<typeof import('@lingui/react')>('@lingui/react');
  return {
    ...actual,
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
      _: (descriptor: unknown) =>
        typeof descriptor === 'string'
          ? descriptor
          : ((descriptor as { message?: string; id?: string })?.message ??
            (descriptor as { id?: string })?.id ??
            ''),
    }),
  };
});

vi.mock('@tensnap/core/scenario/browser', () => ({
  EnvironmentRendererController: class {
    render = vi.fn();
    setViewport = vi.fn();
    destroy = vi.fn();

    constructor() {
      rendererHarness.instances.push(this);
    }
  },
}));

import { AgentDetailsDialog } from './AgentDetailsDialog';
import { Scenario } from '@tensnap/core';

describe('AgentDetailsDialog', () => {
  it('omits the spatial-context notice for uniform agents', () => {
    render(<AgentDetailsDialog agent={{ id: 'agent-1' }} agentType="uniform" onClose={vi.fn()} />);

    expect(screen.queryByText('No spatial context is available for this agent.')).toBeNull();
  });

  it('renders empty custom data inline instead of an empty code block', () => {
    render(<AgentDetailsDialog agent={{ id: 'agent-1', data: {} }} onClose={vi.fn()} />);

    expect(screen.getByText('Custom Data:')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(document.querySelector('pre')).toBeNull();
  });

  it('keeps populated custom data available through the value inspector', () => {
    render(
      <AgentDetailsDialog
        agent={{ id: 'agent-1', data: { status: 'active' } }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText('None')).toBeNull();
    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('allows the radius field to be cleared before normalizing it on blur', () => {
    const scenario = new Scenario();
    scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
    scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
    });
    scenario.apply({
      type: 'item_create',
      payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 'agent-1', x: 1, y: 2 }] },
    });

    render(
      <AgentDetailsDialog
        agent={{ id: 'agent-1', x: 1, y: 2 }}
        agentRef={{ environmentId: 'world', layerId: 'agents', agentId: 'agent-1' }}
        scenario={scenario}
        agentType="2d"
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Inspection radius');
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue(null);

    fireEvent.blur(input);
    expect(input).toHaveValue(3);
  });

  it('keeps one canvas controller while a live agent is updating', () => {
    rendererHarness.reset();
    vi.useFakeTimers();
    try {
      const scenario = new Scenario();
      scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
      scenario.apply({
        type: 'env_layer_create',
        payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
      });
      scenario.apply({
        type: 'item_create',
        payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 'agent-1', x: 1, y: 2 }] },
      });

      const { unmount } = render(
        <AgentDetailsDialog
          agent={{ id: 'agent-1', x: 1, y: 2 }}
          agentRef={{ environmentId: 'world', layerId: 'agents', agentId: 'agent-1' }}
          scenario={scenario}
          agentType="2d"
          onClose={vi.fn()}
        />,
      );

      expect(rendererHarness.instances).toHaveLength(1);
      const controller = rendererHarness.instances[0];

      for (let step = 0; step < 4; step += 1) {
        act(() => {
          scenario.apply({
            type: 'item_update',
            payload: {
              env_id: 'world',
              layer_id: 'agents',
              items: [{ id: 'agent-1', x: step + 2, y: 2 }],
            },
          });
          vi.advanceTimersByTime(100);
        });
      }

      expect(rendererHarness.instances).toEqual([controller]);
      expect(controller.render).toHaveBeenCalledTimes(1);
      expect(controller.setViewport).toHaveBeenCalledTimes(5);

      unmount();
      expect(controller.destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('keeps the inspector dismissible while its first native projection is pending', async () => {
  let signal: AbortSignal | undefined;
  const read = vi.fn((_request, abort: AbortSignal) => {
    signal = abort;
    return new Promise<never>(() => {});
  });
  const close = vi.fn();
  const view = render(
    <AgentDetailsDialog open agent={null} inspectionSource={{ read }} onClose={close} />,
  );
  expect(await screen.findByRole('dialog', { name: 'Agent Details' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

it('retargets the same window after another agent is clicked, preserving radius and recentering when follow is off', () => {
  rendererHarness.reset();
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 20, y: 30 },
      ],
    },
  });
  const props = { scenario, agentType: '2d' as const, onClose: vi.fn() };
  const view = render(
    <AgentDetailsDialog
      {...props}
      agent={{ id: 'a' }}
      agentRef={{ environmentId: 'world', layerId: 'agents', agentId: 'a' }}
    />,
  );
  const shell = screen.getByRole('dialog', { name: 'Agent Details' }).closest('.winbox');
  fireEvent.change(screen.getByLabelText('Inspection radius'), { target: { value: '6' } });
  fireEvent.click(screen.getByRole('checkbox'));
  view.rerender(
    <AgentDetailsDialog
      {...props}
      agent={{ id: 'b' }}
      agentRef={{ environmentId: 'world', layerId: 'agents', agentId: 'b' }}
    />,
  );
  expect(screen.getByRole('dialog', { name: 'Agent Details' }).closest('.winbox')).toBe(shell);
  expect(screen.getByLabelText('Inspection radius')).toHaveValue(6);
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(screen.getByText('b')).toBeTruthy();
  expect(
    rendererHarness.instances[rendererHarness.instances.length - 1].setViewport,
  ).toHaveBeenCalledTimes(1);
  expect(props.onClose).not.toHaveBeenCalled();
});
