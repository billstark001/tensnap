import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { decodeMessagePack } from '@tensnap/protocol';
import type {
  RecordingStoreBackend,
  StoreIndexRow,
  StoreIndexQuery,
} from '@tensnap/core/persistence';

interface RecordingDatabase extends DBSchema {
  objects: { key: string; value: Uint8Array };
  boundaries: {
    key: [string, number];
    value: StoreIndexRow & { prefix: string };
    indexes: { time: [string, number, number]; request: [string, string, number] };
  };
}
/** idb owns transactions/cursors; Web Locks provide live tab ownership and generation pins. */
export class IndexedDBRecordingStore implements RecordingStoreBackend {
  private database?: Promise<IDBPDatabase<RecordingDatabase>>;
  private readonly prefix: string;
  constructor(
    readonly owner: string,
    readonly recordingId: string,
  ) {
    if (!owner || !recordingId)
      throw new Error('Recording storage requires an owner and recording ID.');
    this.prefix = JSON.stringify([owner, recordingId]);
  }
  private open() {
    return (this.database ??= openDB<RecordingDatabase>('tensnap-recording-stores', 1, {
      upgrade(db) {
        db.createObjectStore('objects');
        const boundaries = db.createObjectStore('boundaries');
        boundaries.createIndex('time', ['prefix', 'time', 'frame']);
        boundaries.createIndex('request', ['prefix', 'requestId', 'frame']);
      },
    }));
  }
  private key(key: string) {
    return `${this.prefix}/${key}`;
  }
  async read(key: string): Promise<Uint8Array> {
    const value = await (await this.open()).get('objects', this.key(key));
    if (!value)
      throw Object.assign(new Error(`Missing recording store object: ${key}.`), { code: 'ENOENT' });
    return Uint8Array.from(value);
  }
  async put(key: string, bytes: Uint8Array): Promise<boolean> {
    bytes = Uint8Array.from(bytes);
    const tx = (await this.open()).transaction('objects', 'readwrite');
    const previous = await tx.store.get(this.key(key));
    if (previous) {
      await tx.done;
      if (previous.length !== bytes.length || !previous.every((v, i) => v === bytes[i]))
        throw new Error(`Immutable store object conflicts: ${key}.`);
      return false;
    }
    await tx.store.add(bytes, this.key(key));
    await tx.done;
    return true;
  }
  async publishRoot(expectedGeneration: number, bytes: Uint8Array): Promise<void> {
    bytes = Uint8Array.from(bytes);
    const tx = (await this.open()).transaction('objects', 'readwrite');
    const previous = await tx.store.get(this.key('root'));
    const current = previous ? decodeMessagePack<{ generation: number }>(previous).generation : 0;
    if (current !== expectedGeneration) {
      await tx.done;
      throw new Error('Store generation changed under writer.');
    }
    await tx.store.put(bytes, this.key('root'));
    await tx.done;
  }
  async *list(prefix = ''): AsyncGenerator<string> {
    const db = await this.open();
    let after = this.key(prefix);
    for (;;) {
      const keys = await db.getAllKeys(
        'objects',
        IDBKeyRange.bound(after, `${this.key(prefix)}\uffff`, true, false),
        64,
      );
      if (!keys.length) break;
      for (const key of keys) yield key.slice(this.prefix.length + 1);
      after = keys[keys.length - 1];
    }
  }
  async remove(key: string) {
    await (await this.open()).delete('objects', this.key(key));
  }
  async putIndex(row: StoreIndexRow) {
    await (
      await this.open()
    ).add('boundaries', { ...row, prefix: this.prefix }, [this.prefix, row.frame]);
  }
  async findIndex(query: StoreIndexQuery): Promise<StoreIndexRow | undefined> {
    const tx = (await this.open()).transaction('boundaries');
    const descending = query.match === 'last' || query.match === 'before';
    const direction = descending ? 'prev' : 'next';
    const key =
      query.by === 'frame'
        ? [this.prefix, query.value]
        : [this.prefix, query.value, descending ? Number.MAX_SAFE_INTEGER : 0];
    const exact = query.match === 'first' || query.match === 'last';
    const lower = exact
      ? query.by === 'frame'
        ? key
        : [this.prefix, query.value, query.firstFrame]
      : query.match === 'after'
        ? key
        : query.by === 'frame'
          ? [this.prefix, 0]
          : [this.prefix, -Infinity, 0];
    const upper = exact
      ? query.by === 'frame'
        ? key
        : [this.prefix, query.value, query.lastFrame]
      : query.match === 'before'
        ? key
        : query.by === 'frame'
          ? [this.prefix, Number.MAX_SAFE_INTEGER]
          : [this.prefix, Infinity, Number.MAX_SAFE_INTEGER];
    const range = IDBKeyRange.bound(lower, upper);
    let cursor =
      query.by === 'frame'
        ? await tx.store.openCursor(range, direction)
        : await tx.store
            .index(query.by === 'time' ? 'time' : 'request')
            .openCursor(range, direction);
    let result: StoreIndexRow | undefined;
    while (cursor) {
      if (cursor.value.frame >= query.firstFrame && cursor.value.frame <= query.lastFrame) {
        result = cursor.value;
        break;
      }
      cursor = await cursor.continue();
    }
    await tx.done;
    return result;
  }
  async *frameIndex(firstFrame: number, lastFrame: number): AsyncGenerator<StoreIndexRow> {
    const db = await this.open();
    let next = firstFrame;
    while (next <= lastFrame) {
      const rows = await db.getAll(
        'boundaries',
        IDBKeyRange.bound([this.prefix, next], [this.prefix, lastFrame]),
        64,
      );
      if (!rows.length) break;
      for (const row of rows) yield row;
      next = rows[rows.length - 1].frame + 1;
    }
  }
  async pruneIndex(firstFrame: number) {
    if (firstFrame <= 0) return;
    await (
      await this.open()
    ).delete(
      'boundaries',
      IDBKeyRange.bound([this.prefix, 0], [this.prefix, firstFrame], false, true),
    );
  }
  async rebuildIndex(rows: AsyncIterable<StoreIndexRow>) {
    const db = await this.open();
    const staging = `${this.prefix}:repair:${crypto.randomUUID()}`;
    const stagingRange = IDBKeyRange.bound([staging, 0], [staging, Number.MAX_SAFE_INTEGER]);
    try {
      for await (const row of rows)
        await db.put('boundaries', { ...row, prefix: staging }, [staging, row.frame]);
      const tx = db.transaction('boundaries', 'readwrite');
      await tx.store.delete(
        IDBKeyRange.bound([this.prefix, 0], [this.prefix, Number.MAX_SAFE_INTEGER]),
      );
      let cursor = await tx.store.openCursor(stagingRange);
      while (cursor) {
        await tx.store.put({ ...cursor.value, prefix: this.prefix }, [
          this.prefix,
          cursor.value.frame,
        ]);
        cursor = await cursor.continue();
      }
      await tx.done;
    } finally {
      await db.delete('boundaries', stagingRange);
    }
  }
  async close() {
    (await this.database)?.close();
    this.database = undefined;
  }
  private async lock(
    name: string,
    mode: 'shared' | 'exclusive',
    ifAvailable = false,
  ): Promise<() => Promise<void>> {
    if (!navigator.locks)
      throw new Error('Recording stores require Web Locks for tab-safe ownership.');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let accepted!: () => void, rejected!: (error: unknown) => void;
    const started = new Promise<void>((resolve, reject) => {
      accepted = resolve;
      rejected = reject;
    });
    const completion = navigator.locks.request(name, { mode, ifAvailable }, async (lock) => {
      if (!lock) {
        rejected(new Error('Recording store already has a writer.'));
        return;
      }
      accepted();
      await held;
    });
    void completion.catch(rejected);
    await started;
    return async () => {
      release();
      await completion;
    };
  }
  acquireWriter() {
    return this.lock(`tensnap-store-writer:${this.prefix}`, 'exclusive', true);
  }
  pin(generation: number) {
    return this.lock(`tensnap-store-reader:${this.prefix}:${generation}`, 'shared');
  }
  async pinnedGenerations() {
    if (!navigator.locks) throw new Error('Recording stores require Web Locks.');
    const prefix = `tensnap-store-reader:${this.prefix}:`;
    const { held = [] } = await navigator.locks.query();
    return [
      ...new Set(
        held
          .filter((lock) => lock.name?.startsWith(prefix))
          .map((lock) => Number(lock.name!.slice(prefix.length))),
      ),
    ];
  }
}
