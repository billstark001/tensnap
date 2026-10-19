import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import writeFileAtomic from 'write-file-atomic';

/** Prepare the artifact's directory; the upstream library owns write serialization and atomic replacement. */
export async function writeFileAtomically(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(
    path,
    typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    { fsync: false },
  );
}
