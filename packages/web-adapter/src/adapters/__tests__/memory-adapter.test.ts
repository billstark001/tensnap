import { MemoryFileSystemAdapter } from '../memory-adapter';
import { runFileSystemAdapterContractSuite } from './adapter-contract-suite';

runFileSystemAdapterContractSuite('MemoryFileSystemAdapter', async () => ({
  adapter: new MemoryFileSystemAdapter(),
}));
