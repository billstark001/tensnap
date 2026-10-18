import { writeFileAtomically } from './atomic-file';
import { mkdir, readFile, writeFile, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync as SQLiteDatabase } from 'node:sqlite';
import { decodeMessagePack, encodeMessagePack } from '@tensnap/protocol';
import type {
  RecordingStoreBackend,
  StoreIndexRow,
  StoreIndexQuery,
} from '@tensnap/core/persistence';

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST';
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** Same-directory rename provides process-interruption atomicity; this does not claim power-loss durability. */
export class NodeRecordingStore implements RecordingStoreBackend {
  constructor(
    readonly directory: string,
    private readonly fault?: (stage: 'object' | 'root', key: string) => void | Promise<void>,
  ) {}
  private indexDatabase?: SQLiteDatabase;
  private async index() {
    if (!this.indexDatabase) {
      const { DatabaseSync } = await import('node:sqlite');
      await mkdir(this.directory, { recursive: true });
      const db = new DatabaseSync(join(this.directory, 'index.sqlite'));
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA cache_size=-1024; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS objects(key TEXT PRIMARY KEY, bytes BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS boundaries(frame INTEGER PRIMARY KEY, time REAL, request TEXT, ref BLOB NOT NULL);
        CREATE INDEX IF NOT EXISTS by_time ON boundaries(time, frame);
        CREATE INDEX IF NOT EXISTS by_request ON boundaries(request, frame);`);
      this.indexDatabase = db;
    }
    return this.indexDatabase;
  }
  async putIndex(row: StoreIndexRow) {
    await this.fault?.('object', 'index');
    const db = await this.index();
    db.prepare('INSERT INTO boundaries(frame,time,request,ref) VALUES(?,?,?,?)').run(
      row.frame,
      row.time ?? null,
      row.requestId ?? null,
      encodeMessagePack(row.ref),
    );
  }
  private indexRow(row: Record<string, unknown> | undefined): StoreIndexRow | undefined {
    return row
      ? {
          frame: Number(row.frame),
          time: row.time === null ? undefined : Number(row.time),
          requestId: row.request === null ? undefined : String(row.request),
          ref: decodeMessagePack(row.ref as Uint8Array),
        }
      : undefined;
  }
  async findIndex(query: StoreIndexQuery) {
    const db = await this.index();
    const column = query.by === 'frame' ? 'frame' : query.by === 'time' ? 'time' : 'request';
    const comparison = query.match === 'before' ? '<=' : query.match === 'after' ? '>=' : '=';
    const direction = query.match === 'last' || query.match === 'before' ? 'DESC' : 'ASC';
    return this.indexRow(
      db
        .prepare(
          `SELECT * FROM boundaries WHERE frame BETWEEN ? AND ? AND ${column} ${comparison} ? ORDER BY ${column} ${direction}, frame ${direction} LIMIT 1`,
        )
        .get(query.firstFrame, query.lastFrame, query.value),
    );
  }
  async *frameIndex(firstFrame: number, lastFrame: number): AsyncGenerator<StoreIndexRow> {
    const db = await this.index();
    // Keyset batches keep transactions short while the generation's frame range remains fixed.
    let next = firstFrame;
    while (next <= lastFrame) {
      const rows = db
        .prepare('SELECT * FROM boundaries WHERE frame BETWEEN ? AND ? ORDER BY frame LIMIT 64')
        .all(next, lastFrame);
      if (!rows.length) break;
      for (const row of rows) yield this.indexRow(row)!;
      next = Number(rows[rows.length - 1].frame) + 1;
    }
  }
  async pruneIndex(firstFrame: number) {
    (await this.index()).prepare('DELETE FROM boundaries WHERE frame < ?').run(firstFrame);
  }
  async clearIndex() {
    (await this.index()).exec('DELETE FROM boundaries;');
  }
  close() {
    this.indexDatabase?.close();
    this.indexDatabase = undefined;
  }

  private path(key: string) {
    if (
      !/^(root|writer|segments\/[0-9]{16}|objects\/[a-f0-9]{64}|roots\/[1-9][0-9]*|pins\/[1-9][0-9]*\.[a-f0-9-]+)$/.test(
        key,
      )
    )
      throw new Error('Invalid store key.');
    return join(this.directory, key);
  }
  private isDatabaseKey(key: string) {
    return key.startsWith('objects/') || key.startsWith('segments/') || key.startsWith('roots/');
  }
  async read(key: string): Promise<Uint8Array> {
    this.path(key);
    if (this.isDatabaseKey(key)) {
      const row = (await this.index()).prepare('SELECT bytes FROM objects WHERE key = ?').get(key);
      if (!row) throw Object.assign(new Error(`Missing store object: ${key}`), { code: 'ENOENT' });
      return Uint8Array.from(row.bytes as Uint8Array);
    }
    return new Uint8Array(await readFile(this.path(key)));
  }
  async put(key: string, bytes: Uint8Array): Promise<boolean> {
    const path = this.path(key);
    if (this.isDatabaseKey(key)) {
      await this.fault?.('object', key);
      const db = await this.index();
      const result = db
        .prepare('INSERT OR IGNORE INTO objects(key,bytes) VALUES(?,?)')
        .run(key, bytes);
      if (result.changes) return true;
      const previous = await this.read(key);
      if (previous.length !== bytes.length || !previous.every((v, i) => v === bytes[i]))
        throw new Error(`Immutable store object conflicts: ${key}.`);
      return false;
    }
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
    return true;
  }
  async publishRoot(expectedGeneration: number, bytes: Uint8Array): Promise<void> {
    let generation = 0;
    try {
      generation = decodeMessagePack<{ generation: number }>(await this.read('root')).generation;
    } catch (error) {
      if (!missing(error)) throw error;
    }
    if (generation !== expectedGeneration)
      throw new Error('Store generation changed under the writer.');
    await this.fault?.('root', 'root');
    await writeFileAtomically(this.path('root'), bytes);
  }
  async *list(): AsyncGenerator<string> {
    async function* visit(directory: string, prefix: string): AsyncGenerator<string> {
      let entries;
      try {
        entries = await opendir(directory);
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      for await (const entry of entries) {
        const key = `${prefix}${entry.name}`;
        if (entry.isDirectory()) yield* visit(join(directory, entry.name), `${key}/`);
        else if (!key.startsWith('index.sqlite')) yield key;
      }
    }
    const db = await this.index();
    let after = '';
    for (;;) {
      const rows = db
        .prepare('SELECT key FROM objects WHERE key > ? ORDER BY key LIMIT 64')
        .all(after);
      if (!rows.length) break;
      for (const row of rows) yield String(row.key);
      after = String(rows[rows.length - 1].key);
    }
    yield* visit(this.directory, '');
  }
  async remove(key: string) {
    this.path(key);
    if (this.isDatabaseKey(key)) {
      (await this.index()).prepare('DELETE FROM objects WHERE key = ?').run(key);
      return;
    }
    const { unlink } = await import('node:fs/promises');
    try {
      await unlink(this.path(key));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
  async acquireWriter(): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true });
    const token = randomUUID();
    try {
      await writeFile(this.path('writer'), JSON.stringify({ pid: process.pid, token }), {
        flag: 'wx',
      });
    } catch (error) {
      if (!exists(error)) throw error;
      const owner = JSON.parse(await readFile(this.path('writer'), 'utf8')) as { pid: number };
      if (alive(owner.pid)) throw new Error('Recording store already has a writer.');
      await this.remove('writer');
      return this.acquireWriter();
    }
    return async () => {
      const owner = JSON.parse(await readFile(this.path('writer'), 'utf8')) as { token: string };
      if (owner.token !== token) throw new Error('Recording writer ownership changed.');
      await this.remove('writer');
    };
  }
  async pin(generation: number): Promise<() => Promise<void>> {
    const key = `pins/${generation}.${randomUUID()}`;
    await this.put(key, encodeMessagePack({ pid: process.pid }));
    return () => this.remove(key);
  }
  async pinnedGenerations() {
    const generations = new Set<number>();
    for await (const key of this.list())
      if (key.startsWith('pins/')) {
        const { pid } = decodeMessagePack<{ pid: number }>(await this.read(key));
        if (alive(pid)) generations.add(Number(key.slice(5).split('.')[0]));
        else await this.remove(key);
      }
    return [...generations];
  }
}
