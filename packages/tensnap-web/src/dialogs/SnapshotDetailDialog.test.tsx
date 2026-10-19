import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { useSettingsStore } from '../store/settings';
vi.mock('@/store/file-system/provider', () => ({
  useFileSystem: () => ({ saveFileAs: vi.fn(), writeFile: vi.fn() }),
}));
vi.mock('../components/scenario/Environment2DView', () => ({ Environment2DView: () => null }));
vi.mock('../components/scenario/UniformEnvironmentView', () => ({
  UniformEnvironmentView: () => null,
}));
vi.mock('../components/scenario/ChartView', () => ({ ChartView: () => null }));
import { SnapshotDetailDialog } from './SnapshotDetailDialog';
i18n.load('en', {});
i18n.activate('en');
afterEach(() => vi.useRealTimers());
function fixture(frames = [5, 9, 12]) {
  const snapshot = createSingleSnapshot(new Scenario().dump(), { id: 'replay-test' });
  snapshot.initial.frame = 3;
  snapshot.frames = frames.map((index) => ({
    index,
    timestamp: index * 10,
    kind: 'action',
    controls: [],
    messages: [{ type: 'metadata_update', payload: { time: index } }],
  }));
  return snapshot;
}
function mount(snapshot = fixture()) {
  const onOpenOffline = vi.fn();
  const view = render(
    <I18nProvider i18n={i18n}>
      <SnapshotDetailDialog
        open
        snapshot={snapshot}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onOpenOffline={onOpenOffline}
      />
    </I18nProvider>,
  );
  return { ...view, onOpenOffline };
}
const button = (name: string) => screen.getByRole('button', { name });
const slider = () => screen.getByRole('slider', { name: 'Recording frame' });
it('steps through actual retained frames in both directions and bounds the first/last controls', () => {
  const view = mount();
  expect(slider()).toHaveValue('3');
  expect(button('Previous frame')).toBeDisabled();
  expect(button('First frame')).toBeDisabled();
  expect(
    slider().compareDocumentPosition(screen.getByRole('group', { name: 'Playback controls' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(button('Next frame'));
  expect(slider()).toHaveValue('5');
  fireEvent.click(button('Next frame'));
  expect(slider()).toHaveValue('9');
  fireEvent.click(button('Previous frame'));
  expect(slider()).toHaveValue('5');
  fireEvent.click(button('Last frame'));
  expect(slider()).toHaveValue('12');
  expect(button('Next frame')).toBeDisabled();
  expect(button('Last frame')).toBeDisabled();
  fireEvent.click(button('Open as offline copy'));
  expect(view.onOpenOffline).toHaveBeenCalledWith(12);
  fireEvent.click(button('First frame'));
  expect(slider()).toHaveValue('3');
});
it('pauses for manual navigation, stops exactly at the last frame and can replay from the end', async () => {
  vi.useFakeTimers();
  useSettingsStore.setState({ snapshotPlaybackFps: 10 });
  mount();
  fireEvent.click(button('Play'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(slider()).toHaveValue('5');
  fireEvent.click(button('Previous frame'));
  expect(slider()).toHaveValue('3');
  expect(button('Play')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(slider()).toHaveValue('3');
  fireEvent.click(button('Play'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(slider()).toHaveValue('12');
  expect(button('Play')).toBeTruthy();
  fireEvent.click(button('Play'));
  expect(slider()).toHaveValue('3');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(slider()).toHaveValue('5');
  fireEvent.change(slider(), { target: { value: '9' } });
  expect(button('Play')).toBeTruthy();
  expect(slider()).toHaveValue('9');
});
it('does not add playback controls to a single-frame capture', () => {
  mount(fixture([]));
  expect(screen.queryByRole('slider')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Playback controls' })).toBeNull();
});

it('keeps the retained cursor when recording data is refreshed without changing its identity', () => {
  const snapshot = fixture();
  const view = mount(snapshot);
  fireEvent.click(button('Next frame'));
  fireEvent.click(button('Next frame'));
  expect(slider()).toHaveValue('9');
  view.rerender(
    <I18nProvider i18n={i18n}>
      <SnapshotDetailDialog
        open
        snapshot={structuredClone(snapshot)}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        onOpenOffline={vi.fn()}
      />
    </I18nProvider>,
  );
  expect(slider()).toHaveValue('9');
  fireEvent.click(button('Previous frame'));
  expect(slider()).toHaveValue('5');
});
it('releases replay image URLs across StrictMode acquisition and final unmount', async () => {
  const { StrictMode } = await import('react');
  const create = vi.fn(() => `blob:replay-${Math.random()}`),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const snapshot = fixture([]);
  snapshot.initial.scenario.assets = [
    { meta: { id: 'icon', hash: 'h', mime: 'image/png', size: 3 }, data: Uint8Array.of(1, 2, 3) },
  ];
  try {
    const view = render(
      <StrictMode>
        <I18nProvider i18n={i18n}>
          <SnapshotDetailDialog
            open
            snapshot={snapshot}
            onDelete={vi.fn()}
            onRename={vi.fn()}
            onOpenOffline={vi.fn()}
          />
        </I18nProvider>
      </StrictMode>,
    );
    expect(create.mock.calls.length).toBeGreaterThan(0);
    view.unmount();
    expect(revoke.mock.calls.length).toBe(create.mock.calls.length);
  } finally {
    vi.unstubAllGlobals();
  }
});
