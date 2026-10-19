// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

const mockScenarioStore = {
  connected: false,
  currentTime: null as number | null,
  session: null as any,
  isRecording: false,
  actionMetrics: null,
  runRevision: 0,
};

const mockSettingsStore = {
  setSettingsDialogOpen: vi.fn(),
};

const mockTransportStore = {
  reconnect: vi.fn(),
  isConnecting: false,
  isConnected: vi.fn(() => false),
  canReconnect: vi.fn(() => false),
};

const mockToast = {
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock('@/store/scenario/store', () => ({
  useScenarioStore: (selector: (state: typeof mockScenarioStore) => unknown) =>
    selector(mockScenarioStore),
}));

vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsStore) => unknown) =>
    selector(mockSettingsStore),
}));

vi.mock('@/store/transport', () => ({
  useTransportStore: () => mockTransportStore,
}));

vi.mock('@/store/toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@lingui/react', () => ({
  useLingui: () => ({
    _: (value: unknown) =>
      typeof value === 'string'
        ? value
        : ((value as { message?: string; id?: string }).message ??
          (value as { id?: string }).id ??
          ''),
  }),
  Trans: ({
    children,
    message,
    id,
  }: {
    children?: React.ReactNode;
    message?: string;
    id?: string;
  }) => <>{children ?? message ?? id}</>,
}));

describe('StatusBar', () => {
  beforeEach(() => {
    mockScenarioStore.session = null;
    mockSettingsStore.setSettingsDialogOpen.mockReset();
    mockTransportStore.reconnect.mockReset();
    mockTransportStore.isConnected.mockReset();
    mockTransportStore.isConnected.mockReturnValue(false);
    mockTransportStore.canReconnect.mockReset();
    mockTransportStore.canReconnect.mockReturnValue(false);
  });

  it('disables reconnect when there is no reconnectable scene link', () => {
    render(<StatusBar />);

    const reconnectButton = screen.getByRole('button', { name: 'Reconnect' });
    expect(reconnectButton).toBeDisabled();
    expect(reconnectButton).toHaveStyle({ opacity: '0.5', cursor: 'not-allowed' });
  });

  it('labels simulator step time as model time', () => {
    render(<StatusBar />);

    expect(screen.getByText('Model:')).toBeInTheDocument();
  });
});

it('keeps long run details in the scrollable status region and buttons outside it with accessible names', () => {
  const actionId = 'long-running-action-'.repeat(30);
  mockScenarioStore.session = {
    run: {
      status: {
        spec: { actionId, mode: 'manual' },
        completedActions: 2774,
        succeededActions: 2774,
        failedActions: 0,
        settled: true,
        state: 'stopped',
        stopReason: 'stopped',
      },
    },
  };
  const toggleRight = vi.fn();
  const toggleBottom = vi.fn();
  render(<StatusBar onToggleRightPanel={toggleRight} onToggleBottomPanel={toggleBottom} />);
  const metrics = screen.getByRole('group', { name: 'Runtime status' });
  expect(metrics).toHaveAttribute('tabindex', '0');
  expect(metrics.textContent).toContain(actionId);
  for (const name of ['Reconnect', 'Info', 'Settings']) {
    const button = screen.getByRole('button', { name });
    expect(button).toHaveAttribute('aria-label', name);
    expect(metrics.contains(button)).toBe(false);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Hide Right Panel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Hide Bottom Panel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(toggleRight).toHaveBeenCalledOnce();
  expect(toggleBottom).toHaveBeenCalledOnce();
  expect(mockSettingsStore.setSettingsDialogOpen).toHaveBeenCalledWith(true);
});
