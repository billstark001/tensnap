import { ProjectScope } from '../ProjectScope';
import type * as Transport from '@/transport';
import { fireEvent, render, screen, cleanup, act } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { setupI18n } from '@lingui/core';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/store/settings';
import { SettingsDialog } from './SettingsDialog';
import { CreateNewProjectDialog } from './CreateNewProjectDialog';

vi.mock('@/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof Transport>()),
  listBuiltinModels: () => [],
}));
const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
const original = useSettingsStore.getState().ip_family;
afterEach(() => {
  cleanup();
  useSettingsStore.getState().setIPFamily(original);
});

it('places the IP-family selector in the system settings grid', () => {
  render(
    <I18nProvider i18n={i18n}>
      <SettingsDialog open onOpenChange={() => {}} />
    </I18nProvider>,
  );
  const selector = screen.getByRole('combobox', { name: 'IP family' });
  expect(selector.closest('label')).toBeNull();
  expect(selector.parentElement?.parentElement?.className).toContain('settingItem');
  expect(
    screen.getByText(/IP family applies to new connections and reconnects/),
  ).toBeInTheDocument();
});

it('uses the system policy when validating new project URLs without a project selector', () => {
  useSettingsStore.getState().setIPFamily('ipv6');
  render(
    <I18nProvider i18n={i18n}>
      <CreateNewProjectDialog open onOpenChange={() => {}} onCreateItem={() => {}} />
    </I18nProvider>,
  );
  expect(screen.queryByRole('combobox', { name: 'IP family' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ws://example.com:8765' } });
  expect(screen.getByRole('alert')).toHaveTextContent(/browser cannot force/);
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
});

it('updates recording choices when the owning project renames or imports recordings', async () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  const { act } = await import('@testing-library/react');
  const { useProjectStore } = await import('../store/project');
  const { createSingleSnapshot } = await import('@tensnap/core/snapshot');
  const { Scenario } = await import('@tensnap/core');
  const snapshot = createSingleSnapshot(new Scenario().dump(), {
    id: 'settings-source',
    label: 'Original recording',
  });
  useProjectStore.getState().openOfflineSnapshot(snapshot);
  const project = useProjectStore.getState().activeProject!;
  try {
    render(
      <I18nProvider i18n={i18n}>
        <ProjectScope project={project}>
          <SettingsDialog open onOpenChange={vi.fn()} />
        </ProjectScope>
      </I18nProvider>,
    );
    expect(screen.getAllByText('Original recording').length).toBeGreaterThan(0);
    act(() =>
      project.useScenarioStore.getState().renameSnapshot('settings-source', 'Renamed recording'),
    );
    expect(screen.getAllByText('Renamed recording').length).toBeGreaterThan(0);
    expect(screen.queryByText('Original recording')).toBeNull();
    act(() =>
      project.useScenarioStore.getState().importSnapshots([
        createSingleSnapshot(new Scenario().dump(), {
          id: 'new-source',
          label: 'Imported recording',
        }),
      ]),
    );
    const selector = screen
      .getAllByRole('combobox')
      .find((element) => element.textContent?.includes('Renamed recording'))!;
    fireEvent.keyDown(selector, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: 'Imported recording' })).toBeTruthy();
  } finally {
    cleanup();
    project.useScenarioStore.getState().session.destroy();
    useProjectStore.setState({ projects: [], tabs: [], activeIndex: null, activeProject: null });
    if (scrollIntoView)
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('uses the shared theme switch with an accessible label and keyboard activation', async () => {
  const { default: userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  const theme = useSettingsStore.getState().theme;
  try {
    render(
      <I18nProvider i18n={i18n}>
        <SettingsDialog open onOpenChange={() => {}} />
      </I18nProvider>,
    );
    const control = screen.getByRole('switch', { name: 'Theme' });
    expect(control).toHaveAttribute('aria-checked', String(theme === 'dark'));
    await user.click(control);
    expect(useSettingsStore.getState().theme).toBe(theme === 'dark' ? 'light' : 'dark');
    await user.keyboard(' ');
    expect(useSettingsStore.getState().theme).toBe(theme);
  } finally {
    act(() => useSettingsStore.getState().setTheme(theme));
  }
});
