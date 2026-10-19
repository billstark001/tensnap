import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { setupI18n } from '@lingui/core';
import { expect, it, vi } from 'vitest';
import { MenuBar } from './MenuBar';
import { DOCUMENTATION_URL, MenuBarContext } from './MenuBarContext';
vi.mock('./useFileOperations', () => ({ useFileOperations: () => ({}) }));
vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: any) =>
    selector({ setSettingsDialogOpen: vi.fn(), setAboutDialogOpen: vi.fn() }),
}));
vi.mock('@/store/undo-redo', () => ({ useScenarioUndoRedoStore: () => null }));
const i18n = setupI18n({ locale: 'en', messages: { en: {} } });
it('opens the GitHub documentation from the browser help menu', () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const view = render(
    <I18nProvider i18n={i18n}>
      <MenuBar />
    </I18nProvider>,
  );
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(
      DOCUMENTATION_URL,
      '_blank',
      'noopener,noreferrer',
    );
    expect(screen.queryByRole('menu')).toBeNull();
  } finally {
    view.unmount();
    open.mockRestore();
  }
});
it('dispatches the same help item through the native host capability', () => {
  const openNative = vi.fn().mockResolvedValue(undefined);
  const browser = vi.spyOn(window, 'open').mockReturnValue(null);
  const view = render(
    <I18nProvider i18n={i18n}>
      <MenuBarContext.Provider
        value={{
          environment: 'tauri',
          system: 'mac',
          isFullscreen: false,
          onOpenDocumentation: openNative,
        }}
      >
        <MenuBar />
      </MenuBarContext.Provider>
    </I18nProvider>,
  );
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    expect(openNative).toHaveBeenCalledOnce();
    expect(browser).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    browser.mockRestore();
  }
});
