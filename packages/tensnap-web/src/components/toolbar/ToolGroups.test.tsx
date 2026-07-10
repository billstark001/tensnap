import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_INT32_RUN_STEPS } from '@tensnap/core/runtime';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SimulationControlTools } from './ToolGroups';

const handleButtonAction = vi.fn();

vi.mock('../../hooks/useButtonControls', () => ({
  useButtonControls: () => ({ handleButtonAction }),
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
  useLingui: () => ({ _: (value: unknown) => String(value ?? '') }),
}));

vi.mock('@lingui/macro', () => ({
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (result, part, index) => result + part + String(values[index] ?? ''),
    '',
  ),
}));

describe('SimulationControlTools', () => {
  beforeEach(() => {
    handleButtonAction.mockReset();
  });

  it('starts the toolbar action as an explicit manual persistent run', () => {
    render(
      <Tooltip.Provider>
        <SimulationControlTools />
      </Tooltip.Provider>,
    );

    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(handleButtonAction).toHaveBeenCalledWith('start', true, {
      maxSteps: MAX_INT32_RUN_STEPS,
      record: false,
    });
  });
});
