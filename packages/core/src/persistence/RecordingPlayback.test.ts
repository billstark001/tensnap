import { expect, it, vi } from 'vitest';
import { RecordingPlayback } from './RecordingPlayback';
import type { RecordingStoreReader } from './recording-store';
import { Scenario } from '../scenario';

it('releases scene URLs immediately, cancels late seeks, joins close and disposes on reader failure', async () => {
  const create = vi.fn(() => 'blob:playback');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const scene = new Scenario().dump();
  scene.assets.push({
    meta: { id: 'sprite', hash: 'one', mime: 'image/png', size: 1 },
    data: Uint8Array.of(1),
  });
  let finishClose!: () => void;
  let finishRead!: (value: { scene: typeof scene }) => void;
  const gate = new Promise<void>((resolve) => {
    finishClose = resolve;
  });
  const reader = {
    root: { firstFrame: 0 },
    readFrame: vi
      .fn()
      .mockResolvedValueOnce({ scene })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRead = resolve;
          }),
      ),
    close: vi.fn(async () => {
      await gate;
      throw new Error('reader close failed');
    }),
  };
  const dispose = vi.fn();
  const playback = new RecordingPlayback(reader as unknown as RecordingStoreReader, dispose);
  try {
    await playback.seek(0);
    const seeking = expect(playback.seek(1)).rejects.toThrow('cancelled');
    const closing = playback.close();
    expect(playback.close()).toBe(closing);
    const closed = expect(closing).rejects.toThrow('reader close failed');
    expect(revoke).toHaveBeenCalledOnce();
    finishRead({ scene });
    await seeking;
    finishClose();
    await closed;
    expect(reader.close).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
    await expect(playback.seek(0)).rejects.toThrow('closed');
    await expect(playback.step()).rejects.toThrow('closed');
  } finally {
    finishClose();
    vi.unstubAllGlobals();
  }
});

it('retains both reader and backend cleanup errors', async () => {
  const readerError = new Error('reader failed');
  const backendError = new Error('backend failed');
  const reader = {
    root: { firstFrame: 0 },
    close: async () => {
      throw readerError;
    },
  };
  const playback = new RecordingPlayback(reader as unknown as RecordingStoreReader, async () => {
    throw backendError;
  });
  await expect(playback.close()).rejects.toMatchObject({ errors: [readerError, backendError] });
});

it('does not let a delayed step index lookup replace a newer explicit selection', async () => {
  let resolve!: (location: { frame: number }) => void;
  const reader = {
    root: { firstFrame: 0 },
    nextLocation: () =>
      new Promise((done) => {
        resolve = done;
      }),
    readFrame: vi.fn().mockResolvedValue({ scene: new Scenario().dump() }),
    close: vi.fn(),
  };
  const playback = new RecordingPlayback(reader as unknown as RecordingStoreReader);
  const stepping = expect(playback.step()).rejects.toThrow('cancelled');
  await playback.seek(7);
  resolve({ frame: 1 });
  await stepping;
  expect(playback.frame).toBe(7);
  expect(reader.readFrame).toHaveBeenCalledOnce();
  await playback.close();
});
