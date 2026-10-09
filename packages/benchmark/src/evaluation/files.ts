import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Original images and plots belong in the separately downloadable figure archive. */
export function isFigure(file: string): boolean {
  return /\.(png|apng|jpg|jpeg|gif|webp|avif|svg|pdf|tif|tiff|bmp)$/i.test(file);
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

export function hashBytes(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** Keep progress readable after interruption; a state file is always a complete JSON document. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function repositoryRoot(start = process.cwd()): Promise<string> {
  let directory = path.resolve(start);
  while (!(await exists(path.join(directory, 'pnpm-workspace.yaml')))) {
    const parent = path.dirname(directory);
    if (directory === parent) throw new Error('Could not locate the TenSnap workspace.');
    directory = parent;
  }
  return directory;
}
