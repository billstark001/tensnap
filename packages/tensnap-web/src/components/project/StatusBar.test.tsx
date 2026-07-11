// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from './StatusBar';

const mockScenarioStore = {
  connected: false,
  currentTime: null as number | null,
};

const mockSettingsStore = {
  runtimeTps: null as number | null,
  runtimeMspt: null as number | null,
  simulatorMspt: null as number | null,
  simulatorCommMs: null as number | null,
  simulatorRenderMs: null as number | null,
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
  useScenarioStore: (selector: (state: typeof mockScenarioStore) => unknown) => selector(mockScenarioStore),
}));

vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: (state: typeof mockSettingsStore) => unknown) => selector(mockSettingsStore),
}));

vi.mock('@/store/transport', () => ({
  useTransportStore: () => mockTransportStore,
}));

vi.mock('@/store/toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@lingui/react', () => ({
  useLingui: () => ({
    _: (value: unknown) => typeof value === 'string'
      ? value
      : (value as { message?: string; id?: string }).message ?? (value as { id?: string }).id ?? '',
  }),
  Trans: ({ children, message, id }: { children?: React.ReactNode; message?: string; id?: string }) => <>{children ?? message ?? id}</>,
}));

describe('StatusBar', () => {
  beforeEach(() => {
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
