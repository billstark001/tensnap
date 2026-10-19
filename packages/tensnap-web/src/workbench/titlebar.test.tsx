import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('../store/file-system/provider', () => ({ useFileSystem: () => ({ loading: false }) }));
vi.mock('../components/toolbar/ToolBarLayout', () => ({ ToolBarLayout: () => <div>Menu</div> }));
vi.mock('../components/project/ProjectPanel', () => ({ ProjectPanel: () => <div>Workspace</div> }));
vi.mock('../dialogs/SettingsDialog', () => ({ SettingsDialog: () => null }));
import { App } from '../App';
it('reserves a title row above the menu for macOS overlay windows and hides it in fullscreen or web', () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const view = render(<App environment="tauri" system="mac" isFullscreen={false} />, {
    container: root,
  });
  try {
    const titlebar = root.querySelector<HTMLElement>('.workbench-titlebar')!;
    expect(titlebar.hidden).toBe(false);
    expect(titlebar).toHaveTextContent('TenSnap');
    expect(titlebar).toHaveAttribute('data-tauri-drag-region');
    expect(titlebar.nextElementSibling?.textContent).toBe('Menu');
    view.rerender(<App environment="tauri" system="mac" isFullscreen />);
    expect(titlebar.hidden).toBe(true);
    view.rerender(<App environment="web" system="mac" />);
    expect(titlebar.hidden).toBe(true);
    view.rerender(<App environment="tauri" system="mac" isFullscreen={false} />);
    expect(titlebar.hidden).toBe(false);
  } finally {
    view.unmount();
    root.remove();
  }
});
