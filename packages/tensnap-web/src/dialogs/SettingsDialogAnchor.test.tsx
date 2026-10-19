import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { Providers } from '../Providers';
import { SettingsDialogAnchor } from './SettingsDialogAnchor';
import { useProjectStore } from '../store/project';
import { useSettingsStore } from '../store/settings';
import { initI18n } from '../i18n';
import { createAuxiliaryWindowOwner } from '../workbench/auxiliary-owner';
import { registerProjectWorkbenchCommands } from '../workbench/project-commands';
vi.mock('@tensnap/core/scenario/browser', () => ({
  EnvironmentRendererController: class {
    render = vi.fn();
    setViewport = vi.fn();
    destroy = vi.fn();
  },
}));
function add(id: string) {
  useProjectStore
    .getState()
    .openOfflineSnapshot(createSingleSnapshot(new Scenario().dump(), { id, label: id }));
  return useProjectStore.getState().activeProject!;
}
afterEach(() => {
  cleanup();
  useSettingsStore.getState().setSettingsDialogOpen(false);
  while (useProjectStore.getState().projects.length) {
    useProjectStore.getState().close(0);
    if (useProjectStore.getState().pendingCloseProjectId) useProjectStore.getState().confirmClose();
  }
});
it('native settings commands retain the auxiliary owner through tab switches and release on owner closure', async () => {
  await initI18n('en');
  const a = add('a');
  const next = createSingleSnapshot(new Scenario().dump(), { id: 'a-next', label: 'a-next' });
  a.useScenarioStore.setState({ snapshots: [...a.useScenarioStore.getState().snapshots, next] });
  const owner = createAuxiliaryWindowOwner(
    'SimulatorInfoDialog',
    {
      scenario: a.useScenarioStore.getState().scenario,
      simulatorInfo: null,
      open: true,
      onOpenChange: vi.fn(),
    },
    a.id,
  );
  const b = add('b');
  const stop = registerProjectWorkbenchCommands({
    new: vi.fn(),
    open: vi.fn(),
    'open-recording': vi.fn(),
    documentation: vi.fn(),
  });
  render(
    <Providers>
      <SettingsDialogAnchor />
    </Providers>,
  );
  try {
    await act(async () => {
      await owner.execute({ method: 'menu', command: 'settings' }, new AbortController().signal);
    });
    expect(useSettingsStore.getState().settingsDialogProjectId).toBe(a.id);
    expect(screen.getAllByText('a').length).toBeGreaterThan(0);
    expect(screen.queryByText('b')).toBeNull();
    const selector = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent === 'a')!;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'a-next' }));
    await act(async () => {
      await owner.execute({ method: 'menu', command: 'settings' }, new AbortController().signal);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(a.source).toEqual({ kind: 'snapshot', snapshot_id: 'a-next' }));
    expect(b.source).toEqual({ kind: 'snapshot', snapshot_id: 'b' });
    act(() => useProjectStore.getState().setActive(0));
    act(() => useProjectStore.getState().setActive(1));
    expect(useSettingsStore.getState().settingsDialogProjectId).toBe(a.id);
    act(() => {
      useProjectStore.getState().close(0);
      useProjectStore.getState().confirmClose();
    });
    await waitFor(() => expect(useSettingsStore.getState().settingsDialogOpen).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    stop();
    owner.dispose();
  }
});
