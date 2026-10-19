import { RecordingStoreWriter } from '@tensnap/core/persistence';
import { Scenario } from '@tensnap/core/scenario';
import { NodeRecordingStore } from '../NodeRecordingStore';

const [directory, stage] = process.argv.slice(2);
let armed = false,
  writes = 0;
const backend = new NodeRecordingStore(directory, async () => {
  if (armed && ++writes === Number(stage)) {
    process.stdout.write('interrupt-here\n');
    await new Promise(() => {});
  }
});
const writer = await RecordingStoreWriter.create(backend, {
  id: 'interrupted',
  mode: 'full-history',
});
const scenario = new Scenario();
function input(frame: number) {
  return {
    scene: scenario.dump(),
    timestamp: frame,
    location: { kind: 'recording' as const, sourceId: 'interrupted', revision: frame, frame },
  };
}
await writer.append(input(0));
armed = true;
scenario.apply({
  type: 'asset_metadata',
  payload: { assets: [{ id: 'asset', hash: 'hash', mime: 'application/octet-stream', size: 3 }] },
});
scenario.apply({
  type: 'asset_data',
  payload: {
    id: 'asset',
    hash: 'hash',
    mime: 'application/octet-stream',
    data: new Uint8Array([1, 2, 3]),
  },
});
await writer.append(input(1));
