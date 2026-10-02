/** Validate the transport-neutral v0.3 trajectories from the root suite. */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnyProtocolMessageSchema } from '../packages/protocol/src/schemas.ts';

async function main(): Promise<void> {
  const directory = fileURLToPath(new URL('./traces/', import.meta.url));
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'no conformance traces found');
  for (const file of files) {
    const trace = JSON.parse(await readFile(resolve(directory, file), 'utf8')) as { messages?: unknown[] };
    assert.ok(Array.isArray(trace.messages) && trace.messages.length > 0, `${file}: empty trace`);
    for (const [index, message] of trace.messages.entries()) {
      try {
        AnyProtocolMessageSchema.parse(message);
      } catch (error) {
        throw new Error(`${file}: message ${index} is not canonical`, { cause: error });
      }
    }
  }
  console.log(`validated ${files.length} canonical conformance traces`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
