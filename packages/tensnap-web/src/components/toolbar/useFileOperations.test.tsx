// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFileOperations } from './useFileOperations';

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  saveFileAs: vi.fn(),
  withLoading: vi.fn(),
  openProject: vi.fn(),
  saveProject: vi.fn(),
  createProject: vi.fn(),
  invokeCreateProject: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  saveFormat: 'msgpack' as 'json' | 'msgpack',
}));

vi.mock('@/store/file-system/provider', () => ({
  useFileSystem: () => ({ openFile: mocks.openFile, saveFileAs: mocks.saveFileAs }),
}));

vi.mock('@/store/loading', () => ({
  useWithLoading: () => mocks.withLoading,
}));

vi.mock('@/store/project', () => ({
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    activeProject: null,
    activeFilepath: null,
    new: mocks.createProject,
    open: mocks.openProject,
    save: mocks.saveProject,
  }),
}));

vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ saveFormat: mocks.saveFormat }),
}));

vi.mock('@/dialogs/CreateNewProjectDialogStore', () => ({
  useCreateNewProjectStore: () => ({ invoke: mocks.invokeCreateProject }),
}));

vi.mock('@/store/toast', () => ({
  useToast: () => mocks.toast,
}));

vi.mock('@lingui/core', () => ({
  i18n: {
    _: (descriptor: { message?: string; id?: string }) => descriptor.message ?? descriptor.id ?? '',
  },
}));

describe('useFileOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openFile.mockResolvedValue({ path: '/broken-project.msgpack' });
    mocks.withLoading.mockImplementation((operation: () => Promise<unknown>) => operation());
  });

  it('surfaces a project parse failure as a toast instead of leaving a rejected promise', async () => {
    mocks.openProject.mockRejectedValue(new Error('Invalid project archive'));
    const { result } = renderHook(() => useFileOperations());

    await result.current.onFileOpen();

    expect(mocks.withLoading).toHaveBeenCalledTimes(1);
    expect(mocks.openProject).toHaveBeenCalledWith('/broken-project.msgpack');
    expect(mocks.toast.error).toHaveBeenCalledWith('Failed to open files', 'Error: Invalid project archive');
  });

  it('warns when a project was opened through best-effort recovery', async () => {
    mocks.openProject.mockResolvedValue({ recovered: true, warnings: ['Snapshot 2 was skipped.'] });
    const { result } = renderHook(() => useFileOperations());

    await result.current.onFileOpen();

    expect(mocks.toast.warning).toHaveBeenCalledWith(
      'Project recovered with warnings',
      'Some data was invalid. Valid data was loaded; review the project and save a new copy.',
    );
  });

  it('asks the native picker for the final project extension before saving', async () => {
    mocks.saveFileAs.mockResolvedValue({ path: '/allowed/project.msgpack' });
    mocks.saveProject.mockResolvedValue(undefined);
    const { result } = renderHook(() => useFileOperations());

    await result.current.onFileSaveAs();

    expect(mocks.saveFileAs).toHaveBeenCalledWith({
      title: 'Save As',
      defaultPath: 'project.msgpack',
      filters: [{ name: 'TenSnap MessagePack project', extensions: ['msgpack'] }],
    });
    expect(mocks.saveProject).toHaveBeenCalledWith(undefined, '/allowed/project.msgpack');
  });
});
