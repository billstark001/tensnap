import {
  encodeSnapshotArchive,
  snapshotArchiveForJson,
  type Snapshot,
  type SnapshotArchive,
} from '@tensnap/core/snapshot';

/**
 * Encode persistence segments off the React/Zustand thread when Workers are
 * available. The synchronous fallback keeps SSR, tests, and older browsers
 * functional without changing the archive format.
 */
export async function encodeSnapshotArchivesInWorker(
  snapshots: Snapshot[],
  jsonSafe: boolean,
): Promise<SnapshotArchive[]> {
  if (typeof Worker === 'undefined') {
    return snapshots.map((snapshot) => {
      const archive = encodeSnapshotArchive(snapshot);
      return jsonSafe ? snapshotArchiveForJson(archive) : archive;
    });
  }

  const worker = new Worker(new URL('./snapshot-archive.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<SnapshotArchive[]>((resolve, reject) => {
      const requestId = Date.now() + Math.floor(Math.random() * 10_000);
      worker.addEventListener('message', (event: MessageEvent<{
        id: number;
        archives?: SnapshotArchive[];
        error?: string;
      }>) => {
        if (event.data.id !== requestId) return;
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.archives ?? []);
      }, { once: true });
      worker.addEventListener('error', (event) => reject(event.error ?? new Error(event.message)), { once: true });
      worker.postMessage({ id: requestId, snapshots, jsonSafe });
    });
  } finally {
    worker.terminate();
  }
}
