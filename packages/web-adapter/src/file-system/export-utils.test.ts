import { describe, expect, it } from 'vitest';
import { decodeBinaryString } from '@tensnap/protocol/binary';
import { MemoryFileSystemAdapter } from '../adapters/memory-adapter';
import { exportDirectory } from './export-utils';

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('JSON directory export', () => {
  it.each(['中文と日本語 🐦', 'caf\u00e9', ''])('preserves UTF-8 text %j', async (text) => {
    const fs = new MemoryFileSystemAdapter();
    await fs.initialize();
    const file = await fs.writeFile('/nested/text.txt', text);
    const exported = JSON.parse(await readBlob(await exportDirectory(fs, '/nested')));
    expect(exported.files).toHaveLength(1);
    const bytes = decodeBinaryString(exported.files[0].content).bytes;
    expect(new TextDecoder().decode(bytes)).toBe(text);
    expect(bytes.byteLength).toBe(file.metadata.size);
    expect(exported.files[0].checksum).toBe(file.checksum);
  });

  it('preserves arbitrary binary bytes', async () => {
    const fs = new MemoryFileSystemAdapter();
    await fs.initialize();
    const bytes = new Uint8Array([0, 128, 255, 0]);
    await fs.writeFile('/data.bin', bytes.buffer);
    const exported = JSON.parse(await readBlob(await exportDirectory(fs, '/')));
    expect(decodeBinaryString(exported.files[0].content).bytes).toEqual(bytes);
  });
});
