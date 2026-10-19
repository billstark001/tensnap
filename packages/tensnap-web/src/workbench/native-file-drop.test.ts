import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  drag: undefined as any,
  scale: undefined as any,
  stopDrag: vi.fn(),
  stopScale: vi.fn(),
  highlight: vi.fn(),
  clear: vi.fn(),
  target: vi.fn(),
  importFiles: vi.fn(),
  error: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@tensnap/web', () => ({
  fileDropTargetAt: mock.target,
  importDroppedFiles: mock.importFiles,
  highlightFileDrop: mock.highlight,
  clearFileDropHighlight: mock.clear,
}));
vi.mock('@tensnap/web/store', () => ({
  getFileSystemState: () => ({ readFile: mock.read }),
  useToast: () => ({ error: mock.error }),
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/window.js', () => ({
  getCurrentWindow: () => ({
    scaleFactor: async () => 2,
    onScaleChanged: async (callback: unknown) => {
      mock.scale = callback;
      return mock.stopScale;
    },
  }),
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/webview.js', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (callback: unknown) => {
      mock.drag = callback;
      return mock.stopDrag;
    },
  }),
}));
import { useTauriFileDrop } from '../../../tensnap-tauri/src/hooks/useTauriFileDrop';
beforeEach(() => {
  vi.clearAllMocks();
  mock.drag = undefined;
  mock.scale = undefined;
  mock.target.mockReturnValue({ kind: 'snapshots', projectId: 'original' });
  mock.importFiles.mockResolvedValue([]);
  mock.read.mockResolvedValue({ content: Uint8Array.of(1, 2).buffer });
});
it('converts physical drop positions using the current scale, captures its destination and releases both listeners', async () => {
  const hook = renderHook(useTauriFileDrop);
  await act(async () => {});
  const position = { toLogical: (scale: number) => ({ x: 600 / scale, y: 300 / scale }) };
  await act(async () => {
    mock.drag({ payload: { type: 'drop', position, paths: ['/tmp/有 空格.msgpack'] } });
  });
  expect(mock.target).toHaveBeenLastCalledWith(300, 150);
  const [files, destination] = mock.importFiles.mock.calls[0];
  expect(destination).toEqual({ kind: 'snapshots', projectId: 'original' });
  expect(files[0].name).toBe('有 空格.msgpack');
  expect(await files[0].read()).toEqual(Uint8Array.of(1, 2));
  act(() => mock.scale({ payload: { scaleFactor: 1.5 } }));
  await act(async () => {
    mock.drag({ payload: { type: 'drop', position, paths: ['/tmp/test.json'] } });
  });
  expect(mock.target).toHaveBeenLastCalledWith(400, 200);
  hook.unmount();
  expect(mock.stopDrag).toHaveBeenCalledTimes(1);
  expect(mock.stopScale).toHaveBeenCalledTimes(1);
  const calls = mock.importFiles.mock.calls.length;
  mock.drag({ payload: { type: 'drop', position, paths: ['/tmp/test.json'] } });
  expect(mock.importFiles).toHaveBeenCalledTimes(calls);
});
it('cleans registrations acquired after an early unmount without registering a drop handler', async () => {
  const hook = renderHook(useTauriFileDrop);
  hook.unmount();
  await act(async () => {});
  expect(mock.stopScale).toHaveBeenCalledTimes(1);
  expect(mock.drag).toBeUndefined();
});
