import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { setupI18n } from '@lingui/core';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettingsStore } from '@/store/settings';
import { SettingsDialog } from './SettingsDialog';
import { CreateNewProjectDialog } from './CreateNewProjectDialog';

vi.mock('@/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/transport')>()),
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
