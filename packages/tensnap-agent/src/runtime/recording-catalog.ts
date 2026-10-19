import { access, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const suffix = /\.tensnap-recording\.(json|msgpack)$/;

/** Read both immutable ID directories and recordings written by earlier releases. */
export async function listRecordingFiles(
  directory: string,
): Promise<{ id: string; path: string }[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  const files: { id: string; path: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.pending-')) continue;
    try {
      if (entry.isFile() && suffix.test(entry.name)) {
        files.push({
          id: decodeURIComponent(entry.name.replace(suffix, '')),
          path: join(directory, entry.name),
        });
      } else if (entry.isDirectory() && entry.name.startsWith('id-')) {
        for (const file of await readdir(join(directory, entry.name))) {
          if (suffix.test(file))
            files.push({
              id: decodeURIComponent(entry.name.slice(3)),
              path: join(directory, entry.name, file),
            });
        }
      }
    } catch (error) {
      if (error instanceof URIError || (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return files;
}

/** Publish a complete, nonempty directory atomically. A committed ID can never be replaced,
 * including by a concurrent writer choosing a different serialization format. */
export async function publishRecording(
  directory: string,
  id: string,
  format: 'json' | 'msgpack',
  data: string | Uint8Array,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const encodedId = encodeURIComponent(id);
  for (const extension of ['json', 'msgpack']) {
    try {
      await access(join(directory, `${encodedId}.tensnap-recording.${extension}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(`Recording ID already exists: ${id}`);
  }
  const temporary = await mkdtemp(join(directory, '.pending-'));
  const filename = `recording.tensnap-recording.${format}`;
  try {
    await writeFile(join(temporary, filename), data, { flag: 'wx' });
    const destination = join(directory, `id-${encodedId}`);
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw new Error(`Recording ID already exists: ${id}`, { cause: error });
      throw error;
    }
    return join(destination, filename);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
