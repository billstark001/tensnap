// @vitest-environment jsdom

import React from 'react';

const testHarness = vi.hoisted(() => {
  const controllerInstances: Array<{
    container: HTMLDivElement;
    options: {
      resolveAssetUrl?: (assetId: string) => string | undefined;
      onAgentSelect?: (agent: unknown) => void;
      onRenderError?: (title: string, detail: string) => void;
    };
    render: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    resetView: ReturnType<typeof vi.fn>;
  }> = [];

  const agentDialogPropsCalls: Array<Record<string, unknown>> = [];

  const scenarioGetUrl = vi.fn<(assetId: string) => string | undefined>();
  let scenario = {
    assets: {
      getUrl: scenarioGetUrl,
    },
  };

  let toastError = vi.fn<(title: string, detail: string) => void>();

  function reset() {
    controllerInstances.length = 0;
    agentDialogPropsCalls.length = 0;
    scenarioGetUrl.mockReset();
    scenario = {
      assets: {
        getUrl: scenarioGetUrl,
      },
    };
    toastError = vi.fn();
  }

  return {
    controllerInstances,
    agentDialogPropsCalls,
    scenarioGetUrl,
    get scenario() {
      return scenario;
    },
    set scenario(next: typeof scenario) {
      scenario = next;
    },
    get toastError() {
      return toastError;
    },
    set toastError(next: typeof toastError) {
      toastError = next;
    },
    reset,
  };
});

vi.mock('@tensnap/core/scenario/browser', () => {
  class MockEnvironmentRendererController {
    public render: ReturnType<typeof vi.fn>;
    public destroy: ReturnType<typeof vi.fn>;
    public resetView: ReturnType<typeof vi.fn>;

    constructor(
      public container: HTMLDivElement,
      public options: {
        resolveAssetUrl?: (assetId: string) => string | undefined;
        onAgentSelect?: (agent: unknown) => void;
        onRenderError?: (title: string, detail: string) => void;
      },
    ) {
      this.render = vi.fn();
      this.destroy = vi.fn();
      this.resetView = vi.fn();
      testHarness.controllerInstances.push({
        container,
        options,
        render: this.render,
        destroy: this.destroy,
        resetView: this.resetView,
      });
    }
  }

  return {
    EnvironmentRendererController: MockEnvironmentRendererController,
  };
});

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: { scenario: typeof testHarness.scenario }) => unknown) =>
    selector({ scenario: testHarness.scenario }),
}));

vi.mock('@/store/toast', () => ({
  useToast: () => ({
    error: testHarness.toastError,
  }),
}));

vi.mock('@lingui/react', async () => {
  const actual = await vi.importActual<typeof import('@lingui/react')>('@lingui/react');
  return {
    ...actual,
    Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../dialogs/AgentDetailsDialog', () => ({
  AgentDetailsDialog: (props: Record<string, unknown>) => {
    testHarness.agentDialogPropsCalls.push(props);
    return null;
  },
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Environment2DView } from './Environment2DView';

describe('Environment2DView', () => {
  beforeEach(() => {
    testHarness.reset();
  });

  it('creates controller on mount and calls render with environment', async () => {
    const environment = {
      id: 'env-1',
      type: '2d',
      layers: new Map(),
    } as any;

    render(<Environment2DView environment={environment} />);

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    const controller = testHarness.controllerInstances[0];
    expect(controller.render).toHaveBeenCalledWith(environment);
  });

  it('calls render again when updateTrigger changes without recreating controller', async () => {
    const environment = {
      id: 'env-trigger',
      type: '2d',
      layers: new Map(),
    } as any;

    const { rerender } = render(
      <Environment2DView environment={environment} updateTrigger={0} />,
    );

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    const controller = testHarness.controllerInstances[0];
    expect(controller.render).toHaveBeenCalledTimes(1);

    rerender(<Environment2DView environment={environment} updateTrigger={1} />);

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
      expect(controller.render).toHaveBeenCalledTimes(2);
      expect(controller.render).toHaveBeenNthCalledWith(2, environment);
    });
  });

  it('destroys controller on unmount', async () => {
    const { unmount } = render(
      <Environment2DView
        environment={{ id: 'env-unmount', type: '2d', layers: new Map() } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    const controller = testHarness.controllerInstances[0];
    unmount();

    expect(controller.destroy).toHaveBeenCalledTimes(1);
  });

  it('invokes controller resetView when clicking reset button', async () => {
    render(
      <Environment2DView
        environment={{ id: 'env-reset', type: '2d', layers: new Map() } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button'));

    expect(testHarness.controllerInstances[0].resetView).toHaveBeenCalledTimes(1);
  });

  it('forwards render errors through toast callback and tracks latest toast function', async () => {
    const firstToast = vi.fn();
    testHarness.toastError = firstToast;

    const { rerender } = render(
      <Environment2DView
        environment={{ id: 'env-error', type: '2d', layers: new Map() } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    const onRenderError = testHarness.controllerInstances[0].options.onRenderError;
    expect(onRenderError).toBeTypeOf('function');

    onRenderError?.('Environment render failed', 'first-error');
    expect(firstToast).toHaveBeenCalledWith('Environment render failed', 'first-error');

    const secondToast = vi.fn();
    testHarness.toastError = secondToast;

    rerender(
      <Environment2DView
        environment={{ id: 'env-error', type: '2d', layers: new Map() } as any}
      />,
    );

    onRenderError?.('Environment render failed', 'second-error');
    expect(secondToast).toHaveBeenCalledWith('Environment render failed', 'second-error');
  });

  it('resolveAssetUrl uses the latest scenario store reference', async () => {
    const firstGetUrl = vi.fn<(assetId: string) => string | undefined>().mockReturnValue('first-url');
    testHarness.scenario = {
      assets: {
        getUrl: firstGetUrl,
      },
    };

    const { rerender } = render(
      <Environment2DView
        environment={{ id: 'env-assets', type: '2d', layers: new Map() } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    const resolveAssetUrl = testHarness.controllerInstances[0].options.resolveAssetUrl;
    expect(resolveAssetUrl).toBeTypeOf('function');
    expect(resolveAssetUrl?.('asset-1')).toBe('first-url');

    const secondGetUrl = vi.fn<(assetId: string) => string | undefined>().mockReturnValue('second-url');
    testHarness.scenario = {
      assets: {
        getUrl: secondGetUrl,
      },
    };

    rerender(
      <Environment2DView
        environment={{ id: 'env-assets', type: '2d', layers: new Map() } as any}
      />,
    );

    expect(resolveAssetUrl?.('asset-2')).toBe('second-url');
    expect(firstGetUrl).toHaveBeenCalledWith('asset-1');
    expect(secondGetUrl).toHaveBeenCalledWith('asset-2');
  });

  it('updates AgentDetailsDialog when controller reports agent selection', async () => {
    const selectedAgent = { id: 'agent-1', x: 1, y: 2 };

    render(
      <Environment2DView
        environment={{ id: 'env-agent-select', type: '2d', layers: new Map() } as any}
      />,
    );

    await waitFor(() => {
      expect(testHarness.controllerInstances).toHaveLength(1);
    });

    const onAgentSelect = testHarness.controllerInstances[0].options.onAgentSelect;
    expect(onAgentSelect).toBeTypeOf('function');

    act(() => {
      onAgentSelect?.(selectedAgent);
    });

    await waitFor(() => {
      const latestProps = testHarness.agentDialogPropsCalls[testHarness.agentDialogPropsCalls.length - 1];
      expect(latestProps?.agent).toEqual(selectedAgent);
      expect(latestProps?.agentType).toBe('2d');
    });

    const latestProps = testHarness.agentDialogPropsCalls[testHarness.agentDialogPropsCalls.length - 1] as {
      onClose?: () => void;
    };
    act(() => {
      latestProps.onClose?.();
    });

    await waitFor(() => {
      const afterCloseProps = testHarness.agentDialogPropsCalls[testHarness.agentDialogPropsCalls.length - 1];
      expect(afterCloseProps?.agent).toBeNull();
    });
  });
});
