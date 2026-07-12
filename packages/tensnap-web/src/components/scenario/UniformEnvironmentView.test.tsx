// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStorage } from '@tensnap/core/environment';
import { UniformEnvironmentView } from './UniformEnvironmentView';

const scenarioState = {
  scenario: { assets: { getUrl: vi.fn() } },
  assetRevision: 0,
};

const dialogCalls: Array<Record<string, unknown>> = [];

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof scenarioState) => unknown) => selector(scenarioState),
}));

vi.mock('../../dialogs/AgentDetailsDialog', () => ({
  AgentDetailsDialog: (props: Record<string, unknown>) => {
    dialogCalls.push(props);
    return null;
  },
}));

vi.mock('../../dialogs/AgentIconElement', () => ({
  createIconElement: () => <span data-testid="agent-icon" />,
}));

vi.mock('@tensnap/web-common/components/ui/Pagination', () => ({
  Pagination: ({ totalPages, onPageChange }: { totalPages: number; onPageChange: (page: number) => void }) => (
    <div>
      {Array.from({ length: totalPages }, (_, index) => (
        <button key={index} type="button" onClick={() => onPageChange(index + 1)}>
          Page {index + 1}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@lingui/react', () => ({
  useLingui: () => ({ _: (value: { message?: string } | string) => typeof value === 'string' ? value : value.message ?? '' }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe('UniformEnvironmentView', () => {
  beforeEach(() => {
    dialogCalls.length = 0;
  });

  it('subscribes once and derives only the visible agents page from mutable storage', () => {
    const storage = new AgentStorage();
    storage.addAgents(Array.from({ length: 20 }, (_, index) => ({
      id: `agent-${index}`,
      color: '#666666',
    })));
    const subscribe = vi.spyOn(storage, 'subscribe');
    const environment = {
      id: 'uniform',
      type: 'uniform',
      layers: new Map([['agents', {
        id: 'agents',
        layerType: 'agent',
        metadata: {},
        dependencyLayerIds: {},
        storage,
      }]]),
    } as any;

    render(<UniformEnvironmentView environment={environment} />);

    expect(screen.getByText('#agent-0')).toBeInTheDocument();
    expect(screen.getByText('#agent-11')).toBeInTheDocument();
    expect(screen.queryByText('#agent-12')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('agent-icon')).toHaveLength(12);
    expect(subscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Page 2' }));
    expect(screen.queryByText('#agent-0')).not.toBeInTheDocument();
    expect(screen.getByText('#agent-12')).toBeInTheDocument();
    expect(screen.getAllByTestId('agent-icon')).toHaveLength(8);

    act(() => storage.updateAgent('agent-12', { color: '#ff0000' }));
    expect(screen.getByText(/#ff0000/)).toBeInTheDocument();
    expect(subscribe).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('#agent-12'));
    expect(dialogCalls[dialogCalls.length - 1]?.agentRef).toEqual({
      environmentId: 'uniform',
      layerId: 'agents',
      agentId: 'agent-12',
    });
  });
});
