import {
  encodeSnapshotArchive,
  snapshotArchiveForJson,
  type Snapshot,
} from '@tensnap/core/snapshot';

type EncodeRequest = {
  id: number;
  snapshots: Snapshot[];
  jsonSafe: boolean;
};

type WorkerScope = {
  addEventListener(type: 'message', listener: (event: MessageEvent<EncodeRequest>) => void): void;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener('message', ({ data }) => {
  try {
    const archives = data.snapshots.map((snapshot) => {
      const archive = encodeSnapshotArchive(snapshot);
      return data.jsonSafe ? snapshotArchiveForJson(archive) : archive;
    });
    const transfer = archives.flatMap((archive) => archive.segments.flatMap((segment) => (
      segment.data instanceof Uint8Array ? [segment.data.buffer] : []
    )));
    scope.postMessage({ id: data.id, archives }, transfer);
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
