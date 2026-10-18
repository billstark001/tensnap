import { archiveProjectFileContentAsync, type ProjectFileContent } from '@tensnap/core/persistence';
import { encodeSnapshotArchivesInWorker } from './snapshot-archive';

export function archiveProjectFileContentInWorker(content: ProjectFileContent, jsonSafe = false) {
  return archiveProjectFileContentAsync(content, jsonSafe, encodeSnapshotArchivesInWorker);
}
