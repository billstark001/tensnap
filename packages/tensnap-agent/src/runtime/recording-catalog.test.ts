import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { publishRecording, listRecordingFiles } from './recording-catalog';

it('atomically admits one writer across formats and leaves no partial publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-publish-'));
  try {
    const outcomes = await Promise.allSettled([
      publishRecording(directory, 'same/id', 'json', 'first'),
      publishRecording(directory, 'same/id', 'msgpack', 'second'),
    ]);
    const success = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    expect(success).toHaveLength(1);
    const files = await listRecordingFiles(directory);
    expect(files).toHaveLength(1);
    expect(files[0].id).toBe('same/id');
    const before = await readFile(files[0].path);
    await expect(publishRecording(directory, 'same/id', 'json', 'replacement')).rejects.toThrow();
    expect(await readFile(files[0].path)).toEqual(before);
    expect((await readdir(directory)).some((name) => name.startsWith('.pending-'))).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('protects legacy files regardless of requested format', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tensnap-legacy-publish-'));
  try {
    const path = join(directory, 'legacy.tensnap-recording.json');
    await writeFile(path, 'old');
    await expect(publishRecording(directory, 'legacy', 'msgpack', 'new')).rejects.toThrow(
      'already exists',
    );
    expect(await readFile(path, 'utf8')).toBe('old');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
