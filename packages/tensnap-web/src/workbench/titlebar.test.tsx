import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('../store/file-system/provider', () => ({ useFileSystem: () => ({ loading: false }) }));
vi.mock('../components/toolbar/ToolBarLayout', () => ({ ToolBarLayout: () => <div>Menu</div> }));
vi.mock('../components/project/ProjectPanel', () => ({ ProjectPanel: () => <div>Workspace</div> }));
vi.mock('../dialogs/SettingsDialog', () => ({ SettingsDialog: () => null }));
import { App } from '../App';
it('shares the menu row with macOS overlay controls and removes the reservation in fullscreen or web', () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  const view = render(<App environment="tauri" system="mac" isFullscreen={false} />, {
    container: root,
  });
  try {
    const shell = root.querySelector<HTMLElement>('.workbench-shell')!;
    expect(shell).toHaveAttribute('data-titlebar-overlay');
    expect(root.querySelector('.workbench-titlebar')).toBeNull();
    view.rerender(<App environment="tauri" system="mac" isFullscreen />);
    expect(shell).not.toHaveAttribute('data-titlebar-overlay');
    view.rerender(<App environment="web" system="mac" />);
    expect(shell).not.toHaveAttribute('data-titlebar-overlay');
    view.rerender(<App environment="tauri" system="mac" isFullscreen={false} />);
    expect(shell).toHaveAttribute('data-titlebar-overlay');
  } finally {
    view.unmount();
    root.remove();
  }
});
