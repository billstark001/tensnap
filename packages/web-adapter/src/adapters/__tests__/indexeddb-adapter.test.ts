import { IndexedDBFileSystemAdapter } from '../indexeddb-adapter';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { runFileSystemAdapterContractSuite } from './adapter-contract-suite';

let testCounter = 0;

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = fakeIndexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

runFileSystemAdapterContractSuite('IndexedDBFileSystemAdapter', async () => {
  testCounter += 1;
  const dbName = `tensnap-fs-test-${testCounter}`;

  return {
    adapter: new IndexedDBFileSystemAdapter(dbName),
    cleanup: async () => {
      await deleteDatabase(dbName);
    },
  };
});
