import { IndexedDBRecordingStore } from '@tensnap/web-adapter/adapters';
import { generateUniqueId } from '@/utils/common';
import {
  RecordingPlayback,
  RecordingStoreReader,
  omitUndefinedObjectProperties,
  decodePersistenceValue,
  parseRecordingFile,
  type ContainerView,
} from '@tensnap/core/persistence';
import { createAutoLayout } from '@/utils/view/pack';
import { archiveProjectFileContentInWorker } from '@/workers/project-archive';
import { create, StoreApi, UseBoundStore } from 'zustand';
import { createTransportStore, TransportStore } from './transport';
import {
  parseProjectFileContent,
  PROJECT_FILE_VERSION,
  ProjectSourceSchema,
  recoverProjectFileContent,
  type ProjectFileContent,
} from '@tensnap/core/persistence';
import { encode } from '@msgpack/msgpack';
import { createHistoryStore } from './undo-redo';
import type { HistoryState } from './history-model';
import { useSettingsStore } from './settings';
import { checkMsgpackCompatibility, uint8ArrayToArrayBuffer } from '@tensnap/core/utils';
import {
  createStateSyncInventoryFromSnapshot,
  type StateSyncInventory,
} from '@tensnap/core/scenario';
import {
  SNAPSHOT_PLAYBACK_ACTIONS,
  SnapshotPlaybackSource,
  type ProjectSource,
  type Snapshot,
  type SnapshotModelIdentity,
} from '@tensnap/core/snapshot';
import { createScenarioStore } from './scenario/store';
import type { ScenarioStore } from './scenario/types';
import { getFileSystemState } from './file-system/provider';

export interface ProjectOpenResult {
  recovered: boolean;
  warnings: string[];
}

export interface ProjectContextScheme {
  id: string;
  filepath: string | null;
  source: ProjectSource;
  modelIdentity?: SnapshotModelIdentity;
  snapshotPlayback?: SnapshotPlaybackSource;
  recordingPlayback?: RecordingPlayback;
  recordingStoreLink?: {
    kind: 'tensnap-recording-store-link';
    version: 1;
    owner: string;
    recordingId: string;
  };
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>;
  useTransportStore: UseBoundStore<StoreApi<TransportStore>>;
  useUndoRedoStore: UseBoundStore<StoreApi<HistoryState>>;
}

function projectTabName(project: ProjectContextScheme): string {
  if (!project.filepath)
    return project.source.kind === 'snapshot'
      ? `Snapshot: ${project.source.snapshot_id}`
      : projectSourceDisplayName(project.source);
  const normalized = project.filepath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || project.filepath;
}

export const projectSourceConnectionId = (source: ProjectSource): string | null => {
  if (source.kind === 'websocket') return source.url;
  if (source.kind === 'inmemory') return `inmemory:${source.model_id}`;
  return null;
};

export const projectSourceDisplayName = (source: ProjectSource): string =>
  projectSourceConnectionId(source) ??
  (source.kind === 'snapshot' ? `offline:${source.snapshot_id}` : 'offline');

const createProject = (
  source: ProjectSource,
  filepath: string | null = null,
  modelIdentity?: SnapshotModelIdentity,
): ProjectContextScheme => {
  let project: ProjectContextScheme | null = null;
  const useUndoRedoStore = createHistoryStore({
    maxCommands: 64,
    maxBytes: 4 * 1024 * 1024,
    onError: (error, command) =>
      project?.useScenarioStore.getState().appendDiagnostic({
        severity: 'error',
        domain: 'ui',
        source: 'undo-redo',
        code: 'history_command_failed',
        message: `Unable to ${command.label}: ${error instanceof Error ? error.message : String(error)}`,
        details: error,
      }),
  });
  const useScenarioStore = createScenarioStore(useUndoRedoStore, {
    assertSnapshotSetAllowed: (snapshots) => {
      const protectedId = project?.source.kind === 'snapshot' ? project.source.snapshot_id : null;
      if (protectedId && !snapshots.some((snapshot) => snapshot.metadata.id === protectedId)) {
        throw new Error(
          `Snapshot ${protectedId} is the active project source and cannot be removed.`,
        );
      }
    },
  });
  useScenarioStore.getState().session.setExpectedSimulatorIdentity(modelIdentity);
  const useTransportStore = createTransportStore(useScenarioStore);

  project = {
    id: generateUniqueId(),
    filepath,
    source: structuredClone(source),
    ...(modelIdentity === undefined ? {} : { modelIdentity: structuredClone(modelIdentity) }),
    useScenarioStore,
    useTransportStore,
    useUndoRedoStore,
  };
  return project;
};

function startProjectTransport(
  project: ProjectContextScheme,
  connectionId: string,
  inventory?: StateSyncInventory,
): void {
  // Project creation/opening is local and does not wait for a remote host.
  // Surface immediate setup failures through the project's diagnostics.
  void project.useTransportStore
    .getState()
    .initialize(connectionId, inventory)
    .catch((error: unknown) => {
      project.useScenarioStore.getState().appendDiagnostic({
        severity: 'error',
        domain: 'transport',
        source: 'project-source',
        code: 'connection_setup_failed',
        message: error instanceof Error ? error.message : String(error),
        details: error,
      });
    });
}

export interface ProjectStore {
  projects: ProjectContextScheme[];
  activeIndex: number | null;
  activeProject: ProjectContextScheme | null;
  activeFilepath: string | null;
  tabs: { id: string; name: string; title: string }[];
  /** Project awaiting an explicit renderer-owned discard confirmation. */
  pendingCloseProjectId: string | null;

  setActive: (index: number | null) => void;
  refreshActiveProject: () => void;

  new: (source: ProjectSource, indexHint?: number) => void;
  open: (filepath: string, indexHint?: number) => Promise<ProjectOpenResult>;
  save: (index?: number, saveAsPath?: string) => Promise<void>;
  close: (index: number) => void;
  confirmClose: () => void;
  cancelClose: () => void;
  changeSource: (index: number, source: ProjectSource) => Promise<void>;
  openRecordingStore: (owner: string, recordingId: string, indexHint?: number) => Promise<void>;
  openOfflineSnapshot: (
    snapshot: Snapshot,
    indexHint?: number,
    frame?: number,
    layout?: ContainerView,
  ) => void;
}

function projectInsertionIndex(indexHint: number | undefined, count: number): number {
  const index = indexHint ?? count;
  if (!Number.isInteger(index) || index < 0 || index > count) {
    throw new Error('Invalid project insertion index');
  }
  return index;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeIndex: null,
  activeProject: null,
  activeFilepath: null,
  tabs: [],
  pendingCloseProjectId: null,

  refreshActiveProject() {
    const { projects, activeIndex } = get();
    set({
      tabs: projects.map((project) => ({
        id: project.id,
        name: projectTabName(project),
        title: project.filepath ?? projectSourceDisplayName(project.source),
      })),
      activeProject: activeIndex !== null ? projects[activeIndex] : null,
      activeFilepath: activeIndex !== null ? projects[activeIndex].filepath : null,
    });
  },

  setActive(index) {
    const { projects, refreshActiveProject } = get();

    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= projects.length)) {
      throw new Error('Invalid project index');
    }

    set({ activeIndex: index });
    refreshActiveProject();
  },

  new(sourceInput, indexHint) {
    const { projects, setActive } = get();
    const targetIndex = projectInsertionIndex(indexHint, projects.length);
    const source = ProjectSourceSchema.parse(sourceInput) as ProjectSource;
    if (source.kind === 'snapshot') {
      throw new Error('Create snapshot projects from an existing recording.');
    }
    const newProject = createProject(source);

    const nextProjects = [...projects];
    nextProjects.splice(targetIndex, 0, newProject);
    set({ projects: nextProjects });
    setActive(targetIndex);

    const connectionId = projectSourceConnectionId(source);
    if (connectionId) startProjectTransport(newProject, connectionId);
  },

  async open(filepath, indexHint) {
    const fileSystemState = getFileSystemState();
    const fileContent = await fileSystemState.readFile(filepath);

    if (!fileContent?.content) {
      throw new Error(`File not found: ${filepath}`);
    }

    const rawContent: unknown =
      typeof fileContent.content === 'string'
        ? JSON.parse(fileContent.content)
        : decodePersistenceValue(new Uint8Array(fileContent.content));
    if (
      rawContent &&
      typeof rawContent === 'object' &&
      'kind' in rawContent &&
      rawContent.kind === 'tensnap-recording'
    ) {
      const document = parseRecordingFile(rawContent);
      get().openOfflineSnapshot(document.snapshot, indexHint, document.snapshot.initial.frame);
      return {
        recovered: false,
        warnings: document.report.resourcesComplete
          ? []
          : ['Recording has unresolved resources or external URL dependencies.'],
      };
    }
    const link = parseRecordingStoreLink(rawContent);
    if (link) {
      await get().openRecordingStore(link.owner, link.recordingId, indexHint);
      return { recovered: false, warnings: [] };
    }
    let parsedContent: ProjectFileContent;
    let warnings: string[] = [];
    try {
      parsedContent = parseProjectFileContent(rawContent);
    } catch (error) {
      const recovery = recoverProjectFileContent(rawContent);
      if (!recovery) throw error;
      parsedContent = recovery.content;
      warnings = recovery.warnings;
    }

    const { scenario, mainView, source, snapshots, model_identity } = parsedContent;
    const { projects, setActive } = get();
    const targetIndex = projectInsertionIndex(indexHint, projects.length);

    const newProject = createProject(source, filepath, model_identity);
    newProject.useScenarioStore.setState({ mainView, snapshots });
    if (source.kind === 'snapshot') {
      const snapshot = snapshots.find((entry) => entry.metadata.id === source.snapshot_id);
      if (!snapshot)
        throw new Error(`Snapshot source ${source.snapshot_id} was not found in this project.`);
      newProject.snapshotPlayback = new SnapshotPlaybackSource(snapshot);
      newProject.useScenarioStore.getState().load(newProject.snapshotPlayback.scenario.dump());
    } else {
      newProject.useScenarioStore.getState().load(scenario);
    }
    for (const warning of warnings) {
      newProject.useScenarioStore.getState().appendDiagnostic({
        severity: 'warning',
        domain: 'storage',
        source: 'project-file',
        code: 'recovered_project_data',
        message: warning,
      });
    }

    const nextProjects = [...projects];
    nextProjects.splice(targetIndex, 0, newProject);
    set({ projects: nextProjects });
    setActive(targetIndex);

    const connectionId = projectSourceConnectionId(source);
    if (connectionId)
      startProjectTransport(
        newProject,
        connectionId,
        createStateSyncInventoryFromSnapshot(scenario),
      );
    return { recovered: warnings.length > 0, warnings };
  },

  async save(index, saveAsPath) {
    const { projects, activeIndex, refreshActiveProject } = get();
    const targetIndex = index ?? activeIndex;

    if (
      targetIndex == null ||
      !Number.isInteger(targetIndex) ||
      targetIndex < 0 ||
      targetIndex >= projects.length
    ) {
      throw new Error('Invalid project index');
    }

    const project = projects[targetIndex];
    if (project.recordingStoreLink) {
      const filepath = saveAsPath ?? project.filepath;
      if (!filepath) throw new Error('No file path specified for saving the recording link.');
      await getFileSystemState().writeFile(filepath, JSON.stringify(project.recordingStoreLink));
      project.filepath = filepath;
      project.useUndoRedoStore.getState().markClean();
      refreshActiveProject();
      return;
    }
    const scenarioStore = project.useScenarioStore.getState();
    const savedHistoryStateId = project.useUndoRedoStore.getState().currentStateId;
    const projectFile: ProjectFileContent = {
      version: PROJECT_FILE_VERSION,
      mainView: scenarioStore.mainView,
      scenario: scenarioStore.dump(),
      snapshots: scenarioStore.snapshots,
      source: project.source,
      ...(scenarioStore.session.modelIdentity === null
        ? {}
        : { model_identity: scenarioStore.session.modelIdentity }),
    };

    const basePath = saveAsPath ?? project.filepath;
    if (!basePath) {
      throw new Error('No file path specified for saving the project');
    }

    const saveFormat = useSettingsStore.getState().saveFormat;
    // Save dialogs return the exact path whose fs scope they authorize. The
    // extension/filter is supplied before the dialog opens; never rewrite it
    // after selection or write through a separately-authorized parent path.
    const filepath = basePath;
    const archive = await archiveProjectFileContentInWorker(projectFile, saveFormat === 'json');

    const fileSystemState = getFileSystemState();
    const content =
      saveFormat === 'msgpack'
        ? (() => {
            const serializableProject = omitUndefinedObjectProperties(archive);
            checkMsgpackCompatibility(serializableProject);
            return uint8ArrayToArrayBuffer(encode(serializableProject));
          })()
        : JSON.stringify(archive, null, 2);

    await fileSystemState.writeFile(filepath, content);
    scenarioStore.appendDiagnostic({
      severity: 'info',
      domain: 'storage',
      source: 'project-file',
      code: 'project_saved',
      message: `Project saved to ${filepath}.`,
    });

    project.filepath = filepath;
    project.modelIdentity = scenarioStore.session.modelIdentity ?? undefined;
    // A user may edit while archival or filesystem writes are pending. Only
    // mark the exact state captured above as saved.
    const history = project.useUndoRedoStore.getState();
    if (history.currentStateId === savedHistoryStateId) history.markClean();
    refreshActiveProject();
  },

  async openRecordingStore(owner, recordingId, indexHint) {
    const backend = new IndexedDBRecordingStore(owner, recordingId);
    const reader = await RecordingStoreReader.open(backend);
    const playback = new RecordingPlayback(reader, () => backend.close());
    try {
      await playback.seek(reader.root.firstFrame);
      const { projects, setActive } = get();
      const index = projectInsertionIndex(indexHint, projects.length);
      const project = createProject(
        { kind: 'snapshot', snapshot_id: reader.root.id },
        null,
        reader.root.modelIdentity,
      );
      project.recordingPlayback = playback;
      project.recordingStoreLink = {
        kind: 'tensnap-recording-store-link',
        version: 1,
        owner,
        recordingId,
      };
      project.useScenarioStore.getState().load(playback.scenario.dump());
      const scenario = playback.scenario;
      project.useScenarioStore.setState({
        mainView: createAutoLayout(
          undefined,
          [...scenario.environments.values()].map((env) => ({
            id: env.id,
            type: env.type,
            label: env.id,
          })),
          [...scenario.parameters.values()],
          scenario.charts.getGroupList(),
          {},
          SNAPSHOT_PLAYBACK_ACTIONS.map((id) => ({
            id,
            label: id,
            scope: 'model' as const,
            continuous: id === 'start',
          })),
          [...scenario.monitors.all.values()],
        ),
      });
      const next = [...projects];
      next.splice(index, 0, project);
      set({ projects: next });
      setActive(index);
    } catch (error) {
      await playback.close();
      throw error;
    }
  },

  openOfflineSnapshot(snapshot, indexHint, frame, layout) {
    const { projects, setActive } = get();
    const targetIndex = projectInsertionIndex(indexHint, projects.length);
    if (frame !== undefined && !Number.isSafeInteger(frame))
      throw new Error('Snapshot frame must be a safe integer.');
    const sourceSnapshot = structuredClone(snapshot);
    if (
      frame !== undefined &&
      frame !== snapshot.initial.frame &&
      !snapshot.frames.some((entry) => entry.index === frame)
    )
      throw new Error('Select an actual retained snapshot frame.');
    const identity = sourceSnapshot.metadata.id;
    const source: ProjectSource = { kind: 'snapshot', snapshot_id: identity };
    const project = createProject(source, null, sourceSnapshot.metadata.model_identity);
    project.snapshotPlayback = new SnapshotPlaybackSource(sourceSnapshot);
    if (frame !== undefined) project.snapshotPlayback.seek(frame);
    project.useScenarioStore.getState().load(project.snapshotPlayback.scenario.dump());
    const scenario = project.useScenarioStore.getState().scenario;
    project.useScenarioStore.setState({
      mainView: layout
        ? structuredClone(layout)
        : createAutoLayout(
            undefined,
            [...scenario.environments.values()].map((env) => ({
              id: env.id,
              type: env.type,
              label: env.id,
            })),
            [...scenario.parameters.values()],
            scenario.charts.getGroupList(),
            {},
            SNAPSHOT_PLAYBACK_ACTIONS.map((id) => ({
              id,
              label: id,
              scope: 'model' as const,
              continuous: id === 'start',
            })),
            [...scenario.monitors.all.values()],
          ),
    });
    project.useScenarioStore.setState({ snapshots: [sourceSnapshot] });
    const nextProjects = [...projects];
    nextProjects.splice(targetIndex, 0, project);
    set({ projects: nextProjects });
    setActive(targetIndex);
  },

  close(index) {
    const { projects } = get();

    if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
      throw new Error('Invalid project index');
    }

    const history = projects[index].useUndoRedoStore.getState();
    if (history.isDirty()) {
      set({ pendingCloseProjectId: projects[index].id });
      return;
    }

    closeProject(index, set, get);
  },

  confirmClose() {
    const { pendingCloseProjectId, projects } = get();
    if (!pendingCloseProjectId) return;
    const index = projects.findIndex((project) => project.id === pendingCloseProjectId);
    if (index === -1) {
      set({ pendingCloseProjectId: null });
      return;
    }
    closeProject(index, set, get);
  },

  cancelClose() {
    set({ pendingCloseProjectId: null });
  },

  async changeSource(index, nextSource) {
    const { projects } = get();

    if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
      throw new Error('Invalid project index');
    }

    const project = projects[index];
    const source = ProjectSourceSchema.parse(nextSource) as ProjectSource;
    if (
      (source.kind === 'websocket' &&
        project.source.kind === 'websocket' &&
        source.url === project.source.url) ||
      (source.kind === 'inmemory' &&
        project.source.kind === 'inmemory' &&
        source.model_id === project.source.model_id) ||
      (source.kind === 'snapshot' &&
        project.source.kind === 'snapshot' &&
        source.snapshot_id === project.source.snapshot_id)
    ) {
      return;
    }
    const scenarioStore = project.useScenarioStore.getState();

    if (source.kind === 'snapshot') {
      const snapshot = scenarioStore.snapshots.find(
        (entry) => entry.metadata.id === source.snapshot_id,
      );
      if (!snapshot)
        throw new Error(`Snapshot source ${source.snapshot_id} was not found in this project.`);
      // Fully materialize the candidate before destroying the current source.
      // From here on every operation consumes a validated in-memory snapshot.
      const playback = new SnapshotPlaybackSource(snapshot);
      const nextScenario = playback.scenario.dump();
      void project.recordingPlayback?.close();
      project.useTransportStore.getState().destroy();
      scenarioStore.session.resetSimulatorIdentity();
      scenarioStore.load(nextScenario);
      project.snapshotPlayback = playback;
    } else {
      const connectionId = projectSourceConnectionId(source);
      if (!connectionId) throw new Error('Project source has no transport connection.');
      // changeTransport connects and buffers the candidate before replacing
      // the current transport, so a failure leaves the old source untouched.
      await project.useTransportStore
        .getState()
        .changeTransport(connectionId, undefined, { resetSimulatorIdentity: true });
      project.snapshotPlayback = undefined;
    }

    project.modelIdentity = undefined;
    project.source = source;
    get().refreshActiveProject();
  },
}));

function closeProject(
  index: number,
  set: (partial: Partial<ProjectStore>) => void,
  get: () => ProjectStore,
): void {
  const { projects, activeIndex, setActive } = get();
  const project = projects[index];
  if (!project) return;

  void project.recordingPlayback?.close();
  project.useTransportStore.getState().destroy();
  project.useScenarioStore.getState().clearAll();
  const nextProjects = [...projects];
  nextProjects.splice(index, 1);

  const newActiveIndex =
    activeIndex === null || nextProjects.length === 0
      ? null
      : index < activeIndex
        ? activeIndex - 1
        : index === activeIndex
          ? Math.min(index, nextProjects.length - 1)
          : activeIndex;

  set({ projects: nextProjects, pendingCloseProjectId: null });
  setActive(newActiveIndex);
}

/** Parse external recordings without opening the source of an enclosing project. */
export async function readRecordingSources(filepath: string): Promise<{
  snapshots: Snapshot[];
  layout?: ContainerView;
  storeLink?: ProjectContextScheme['recordingStoreLink'];
}> {
  const file = await getFileSystemState().readFile(filepath);
  if (!file?.content) throw new Error(`File not found: ${filepath}`);
  const raw =
    typeof file.content === 'string'
      ? JSON.parse(file.content)
      : decodePersistenceValue(new Uint8Array(file.content));
  const link = parseRecordingStoreLink(raw);
  if (link) return { snapshots: [], storeLink: link };
  if (raw && typeof raw === 'object' && 'snapshots' in raw && !('kind' in raw)) {
    const project = parseProjectFileContent(raw);
    return { snapshots: project.snapshots, layout: project.mainView };
  }
  return { snapshots: [parseRecordingFile(raw, { allowLegacy: true }).snapshot] };
}

function parseRecordingStoreLink(value: unknown): ProjectContextScheme['recordingStoreLink'] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== 'tensnap-recording-store-link'
  )
    return undefined;
  const link = value as Record<string, unknown>;
  if (
    link.version !== 1 ||
    typeof link.owner !== 'string' ||
    !link.owner ||
    typeof link.recordingId !== 'string' ||
    !link.recordingId ||
    Object.keys(link).some((key) => !['kind', 'version', 'owner', 'recordingId'].includes(key))
  )
    throw new Error('Invalid recording store link.');
  return {
    kind: 'tensnap-recording-store-link',
    version: 1,
    owner: link.owner,
    recordingId: link.recordingId,
  };
}
