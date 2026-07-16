// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ParameterControl } from './ParameterControl';

const setParameter = vi.fn();
const scenarioState: {
  connected: boolean;
  session: any;
  parameterUpdateTrigger: { value: number };
  runRevision: number;
} = {
  connected: true,
  session: { identityStatus: 'matching', run: { status: null }, setParameter },
  parameterUpdateTrigger: { value: 0 },
  runRevision: 0,
};
const projectState = { activeProject: null as any };

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof scenarioState) => unknown) => selector(scenarioState),
}));

vi.mock('@/store/project', () => ({
  useProjectStore: (selector: (state: typeof projectState) => unknown) => selector(projectState),
}));

describe('ParameterControl', () => {
  beforeEach(() => {
    setParameter.mockReset();
    scenarioState.connected = true;
    scenarioState.session = { identityStatus: 'matching', run: { status: null }, setParameter };
    scenarioState.runRevision = 0;
    projectState.activeProject = null;
  });

  it('uses the guarded renderer session and preserves zero-valued numeric bounds', () => {
    const { rerender } = render(<ParameterControl parameter={{
      id: 'rate', label: 'Rate', type: 'number', value: 0, min: 0, max: 0, step: 0.5,
    }} />);

    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '0');
    expect(slider).toHaveAttribute('step', '0.5');

    rerender(<ParameterControl parameter={{
      id: 'rate', label: 'Rate', type: 'number', value: 0, min: 0, max: 1, step: 0.5,
    }} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } });
    expect(setParameter).toHaveBeenCalledWith('rate', 0.5);
  });

  it('disables runtime edits unless the parameter explicitly allows them', () => {
    scenarioState.session.run.status = { state: 'running' };
    const { rerender } = render(<ParameterControl parameter={{
      id: 'rate', label: 'Rate', type: 'number', value: 2, min: 0, max: 10, step: 1,
    }} />);

    expect(screen.getByRole('slider')).toBeDisabled();

    rerender(<ParameterControl parameter={{
      id: 'rate', label: 'Rate', type: 'number', value: 2, min: 0, max: 10, step: 1, allow_runtime_change: true,
    }} />);
    expect(screen.getByRole('slider')).not.toBeDisabled();
  });
});
