import { decodePersistenceValue, validateRecording } from '@tensnap/core/persistence';
import { parseRecordingSources, useProjectStore } from '../store/project';

export interface IncomingFile {
  name: string;
  path?: string;
  read: () => Promise<Uint8Array>;
}
export type FileDropTarget =
  | { kind: 'workbench' }
  | { kind: 'snapshots'; projectId: string | null };

/** Capture the destination at drop time, before any asynchronous file reads. */
export function fileDropTargetAt(x: number, y: number): FileDropTarget {
  const target = document.elementFromPoint(x, y)?.closest('[data-file-drop-target="snapshots"]');
  return target
    ? { kind: 'snapshots', projectId: useProjectStore.getState().activeProject?.id ?? null }
    : { kind: 'workbench' };
}

export async function importDroppedFiles(
  files: IncomingFile[],
  target: FileDropTarget,
): Promise<string[]> {
  const errors: string[] = [];
  let projectId = target.kind === 'snapshots' ? target.projectId : null;
  for (const file of files) {
    try {
      const bytes = await file.read();
      const projects = useProjectStore.getState();
      if (target.kind === 'workbench') {
        await projects.openContent(bytes, { filepath: file.path, name: file.name });
        continue;
      }
      const { snapshots, layout, storeLink } = parseRecordingSources(decodePersistenceValue(bytes));
      if (storeLink) {
        await projects.openRecordingStore(storeLink.owner, storeLink.recordingId);
        continue;
      }
      if (!snapshots.length) throw new Error('The file contains no recordings.');
      snapshots.forEach(validateRecording);
      if (projectId === null) {
        // Validate the whole first batch before creating its source tab.
        const ids = new Set(snapshots.map((snapshot) => snapshot.metadata.id));
        if (ids.size !== snapshots.length)
          throw new Error('The file contains duplicate recording IDs.');
        projects.openOfflineSnapshot(snapshots[0], undefined, undefined, layout);
        const project = useProjectStore.getState().activeProject!;
        projectId = project.id;
        if (snapshots.length > 1)
          project.useScenarioStore.getState().importSnapshots(snapshots.slice(1));
      } else {
        const project = projects.projects.find((entry) => entry.id === projectId);
        if (!project) throw new Error('The destination tab was closed during import.');
        project.useScenarioStore.getState().importSnapshots(snapshots);
      }
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return errors;
}

export function installBrowserFileDrop(onErrors: (errors: string[]) => void): () => void {
  const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
  const over = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    highlightFileDrop(event.clientX, event.clientY);
  };
  const leave = (event: DragEvent) => {
    if (!event.relatedTarget) clearFileDropHighlight();
  };
  const drop = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    // The file picker's upload area owns its drops.
    if ((event.target as Element)?.closest('[data-file-picker]')) return;
    const files = Array.from(event.dataTransfer!.files);
    const target = fileDropTargetAt(event.clientX, event.clientY);
    clearFileDropHighlight();
    void importDroppedFiles(
      files.map((file) => ({
        name: file.name,
        read: async () => new Uint8Array(await file.arrayBuffer()),
      })),
      target,
    ).then(onErrors);
  };
  document.addEventListener('dragover', over);
  document.addEventListener('dragleave', leave);
  document.addEventListener('drop', drop);
  return () => {
    clearFileDropHighlight();
    document.removeEventListener('dragover', over);
    document.removeEventListener('dragleave', leave);
    document.removeEventListener('drop', drop);
  };
}
export function clearFileDropHighlight(): void {
  document
    .querySelectorAll('[data-file-drop-active]')
    .forEach((node) => node.removeAttribute('data-file-drop-active'));
}
export function highlightFileDrop(x: number, y: number): void {
  clearFileDropHighlight();
  const node = document.elementFromPoint(x, y)?.closest('[data-file-drop-target]');
  node?.setAttribute('data-file-drop-active', '');
}
