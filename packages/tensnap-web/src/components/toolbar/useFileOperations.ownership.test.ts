import { act, renderHook, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { useProjectStore } from '../../store/project';
import { useSettingsStore } from '../../store/settings';
import { useFileOperations, saveProject, saveProjectFile } from './useFileOperations';
import { initI18n } from '../../i18n';
import { useLoadingStore } from '../../store/loading';

const io = vi.hoisted(() => ({ saveFileAs: vi.fn(), writeFile: vi.fn(), openFile: vi.fn() }));
vi.mock('../../store/file-system/provider', () => ({
  getFileSystemState: () => io,
  useFileSystem: () => io,
}));
function add(id: string) {
  const scene = new Scenario();
  scene.apply({ type: 'metadata_update', payload: { label: id } });
  useProjectStore.getState().openOfflineSnapshot(createSingleSnapshot(scene.dump(), { id }));
  return useProjectStore.getState().activeProject!;
}
beforeEach(async () => {
  await initI18n('en');
  io.writeFile.mockResolvedValue(undefined);
  useSettingsStore.getState().setSaveFormat('json');
});
afterEach(() => {
  cleanup();
  while (useProjectStore.getState().projects.length) {
    useProjectStore.getState().close(0);
    if (useProjectStore.getState().pendingCloseProjectId) useProjectStore.getState().confirmClose();
  }
  vi.clearAllMocks();
});
it('toolbar Save As retains the original project and format while the picker is suspended', async () => {
  const a = add('a');
  let resolve!: (file: { path: string }) => void;
  io.saveFileAs.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const hook = renderHook(useFileOperations);
  let saving!: Promise<void>;
  act(() => {
    saving = Promise.resolve(hook.result.current.onFileSaveAs());
  });
  act(() => {
    add('b');
    useSettingsStore.getState().setSaveFormat('msgpack');
  });
  await act(async () => {
    resolve({ path: '/a.json' });
    await saving;
  });
  expect(a.filepath).toBe('/a.json');
  expect(useProjectStore.getState().activeProject!.filepath).toBeNull();
  const [path, content] = io.writeFile.mock.calls[0];
  expect(path).toBe('/a.json');
  expect(typeof content).toBe('string');
  expect(JSON.parse(content).scenario.metadata.label).toBe('a');
});
it('fails closed if the original project is removed during the picker', async () => {
  const a = add('a');
  let resolve!: (file: { path: string }) => void;
  io.saveFileAs.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const saving = expect(saveProjectFile(a.id, true)).rejects.toThrow('closed');
  add('b');
  useProjectStore.getState().close(0);
  resolve({ path: '/a.json' });
  await saving;
  expect(io.writeFile).not.toHaveBeenCalled();
});

it('requests the final MessagePack extension and filter before saving', async () => {
  const a = add('a');
  useSettingsStore.getState().setSaveFormat('msgpack');
  io.saveFileAs.mockResolvedValueOnce({ path: '/allowed/project.msgpack' });
  await saveProjectFile(a.id, true);
  expect(io.saveFileAs).toHaveBeenCalledWith({
    title: 'Save As',
    defaultPath: 'project.msgpack',
    filters: [{ name: 'TenSnap project', extensions: ['msgpack'] }],
  });
  expect(io.writeFile.mock.calls[0][0]).toBe('/allowed/project.msgpack');
  expect(io.writeFile.mock.calls[0][1]).toBeInstanceOf(ArrayBuffer);
});

it.each([
  { name: 'Save on a new project', existing: false, saveAs: false },
  { name: 'Save As on a new project', existing: false, saveAs: true },
  { name: 'Save As on an existing project', existing: true, saveAs: true },
])('$name only blocks the workspace after the picker returns', async ({ existing, saveAs }) => {
  const project = add('a');
  // Give the project a saved path without going through the picker under test.
  if (existing) await useProjectStore.getState().save(0, '/original.json', 'json');
  io.writeFile.mockClear();
  let choose!: (file: { path: string }) => void;
  let finishWrite!: () => void;
  io.saveFileAs.mockReturnValueOnce(
    new Promise((resolve) => {
      choose = resolve;
    }),
  );
  io.writeFile.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishWrite = resolve;
    }),
  );
  const hook = renderHook(useFileOperations);
  let saving!: Promise<void>;
  act(() => {
    saving = Promise.resolve(
      saveAs ? hook.result.current.onFileSaveAs() : hook.result.current.onFileSave(),
    );
  });
  const loadingDuringPicker = useLoadingStore.getState().loading;
  const writesDuringPicker = io.writeFile.mock.calls.length;
  await act(async () => {
    choose({ path: '/saved.json' });
    await waitFor(() => expect(io.writeFile).toHaveBeenCalledOnce());
  });
  const loadingDuringWrite = useLoadingStore.getState().loading;
  await act(async () => {
    finishWrite();
    await saving;
  });
  expect(loadingDuringPicker).toBe(false);
  expect(writesDuringPicker).toBe(0);
  expect(loadingDuringWrite).toBe(true);
  expect(useLoadingStore.getState().loading).toBe(false);
  expect(project.filepath).toBe('/saved.json');
});

it.each(['cancel', 'reject'])(
  'picker %s leaves the workspace unblocked without writing',
  async (result) => {
    const project = add('a');
    let loadingDuringPicker: boolean | undefined;
    io.saveFileAs.mockImplementationOnce(async () => {
      loadingDuringPicker = useLoadingStore.getState().loading;
      if (result === 'reject') throw new Error('Picker failed');
      return null;
    });
    const saving = saveProject(project.id, true);
    if (result === 'reject') await expect(saving).rejects.toThrow('Picker failed');
    else await saving;
    expect(loadingDuringPicker).toBe(false);
    expect(useLoadingStore.getState().loading).toBe(false);
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(project.filepath).toBeNull();
  },
);

it('a failed write releases loading and keeps the project unsaved', async () => {
  const project = add('a');
  io.saveFileAs.mockResolvedValueOnce({ path: '/saved.json' });
  io.writeFile.mockRejectedValueOnce(new Error('Write failed'));
  await expect(saveProject(project.id, true)).rejects.toThrow('Write failed');
  expect(useLoadingStore.getState().loading).toBe(false);
  expect(project.filepath).toBeNull();
});
