import { create, StoreApi, UseBoundStore } from "zustand";
import { createTransportStore, TransportStore } from "./transport";
import { generateUniqueId } from "@/utils/common";
import {
  archiveProjectFileContentInWorker,
  parseProjectFileContent,
  PROJECT_FILE_VERSION,
  ProjectSourceSchema,
  recoverProjectFileContent,
  type ProjectFileContent,
} from "@/types/project";
import { decode, encode } from "@msgpack/msgpack";
import { ChartGroup, ChartMetadata } from "@/types/model";
import { createHistoryStore, type HistoryState } from "./undo-redo";
import { useSettingsStore } from "./settings";
import { checkMsgpackCompatibility, uint8ArrayToArrayBuffer } from "@/utils/msgpack";
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import { materializeSnapshot, SnapshotPlaybackSource, type ProjectSource, type Snapshot, type SnapshotModelIdentity } from '@tensnap/core/snapshot';
import type { StateSyncRequest } from '@tensnap/protocol';
import { createScenarioStore, ScenarioStore } from "./scenario/store";
import { getFileSystemState } from "./file-system/provider";

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
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>;
  useTransportStore: UseBoundStore<StoreApi<TransportStore>>;
  useUndoRedoStore: UseBoundStore<StoreApi<HistoryState>>;
}

function projectTabName(project: ProjectContextScheme): string {
  if (!project.filepath) return project.source.kind === 'snapshot'
    ? `Snapshot: ${project.source.snapshot_id}`
    : projectSourceDisplayName(project.source);
  const normalized = project.filepath.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || project.filepath;
}

const getAllChartMetadata = (chartGroups: ChartGroup[]): ChartMetadata[] => {
  const seen = new Set<string>();
  const metadata: ChartMetadata[] = [];

  for (const group of chartGroups) {
    for (const meta of Object.values(group.metadataDict)) {
      if (!seen.has(meta.id)) {
        metadata.push(meta);
        seen.add(meta.id);
      }
    }
  }

  return metadata;
};

export type StateSyncInventory = Pick<StateSyncRequest, 'parameters' | 'actions' | 'envs' | 'charts' | 'monitors'>;

export const createStateSyncRequestFromStore = (store?: ScenarioSnapshot): StateSyncInventory => {
  const { parameters = [], actions = [], environments = [], charts = [], monitors = [] } = store || {};
  return {
    parameters,
    actions,
    envs: environments.map(env => ({
      id: env.id,
      type: env.type,
      layers: env.layers.map(layer => ({ layer_id: layer.id, layer_type: layer.layerType })),
    })),
    charts: getAllChartMetadata(charts),
    monitors: monitors.map((monitor) => ({
      id: monitor.id,
      label: monitor.label,
      ...(monitor.render_hint === undefined ? {} : { render_hint: monitor.render_hint }),
    })),
  };
};

export const projectSourceConnectionId = (source: ProjectSource): string | null => {
  if (source.kind === 'websocket') return source.url;
  if (source.kind === 'inmemory') return `inmemory:${source.model_id}`;
  return null;
};

export const projectSourceDisplayName = (source: ProjectSource): string => projectSourceConnectionId(source) ?? (source.kind === 'snapshot' ? `offline:${source.snapshot_id}` : 'offline');

/** Rebase a recording so a snapshot project starts at the frame the user chose. */
const snapshotSourceFromFrame = (snapshot: Snapshot, frame?: number): Snapshot => {
  const initialFrame = frame ?? snapshot.frames[snapshot.frames.length - 1]?.index ?? snapshot.initial.frame;
  const bounded = Math.max(snapshot.initial.frame, Math.min(initialFrame, snapshot.frames[snapshot.frames.length - 1]?.index ?? snapshot.initial.frame));
  if (bounded === snapshot.initial.frame) return structuredClone(snapshot);
  const frameTimestamp = snapshot.frames.find((entry) => entry.index === bounded)?.timestamp ?? snapshot.initial.timestamp;
  const rebased = structuredClone(snapshot);
  rebased.initial = { frame: bounded, timestamp: frameTimestamp, scenario: materializeSnapshot(snapshot, bounded) };
  rebased.keyframes = rebased.keyframes.filter((keyframe) => keyframe.frame > bounded);
  rebased.frames = rebased.frames.filter((entry) => entry.index > bounded);
  return rebased;
};

const createProject = (
  source: ProjectSource,
  filepath: string | null = null,
  modelIdentity?: SnapshotModelIdentity,
): ProjectContextScheme => {
  let project: ProjectContextScheme | null = null;
  const useUndoRedoStore = createHistoryStore({
    maxCommands: 64,
    maxBytes: 4 * 1024 * 1024,
    onError: (error, command) => project?.useScenarioStore.getState().appendDiagnostic({
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
        throw new Error(`Snapshot ${protectedId} is the active project source and cannot be removed.`);
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

/**
 * JSON omits undefined object properties, whereas MessagePack writes them as
 * null. Strip them explicitly so both save formats have the same on-disk
 * shape and continue to satisfy the project schema after a round trip.
 */
const omitUndefinedObjectProperties = (value: unknown): unknown => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new Error(`Project data contains an undefined array item at index ${index}.`);
      }
      return omitUndefinedObjectProperties(item);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = omitUndefinedObjectProperties(item);
  }
  return result;
};

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
  openOfflineSnapshot: (snapshot: Snapshot, indexHint?: number, frame?: number) => void;
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
      tabs: projects.map(project => ({
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

    if (index !== null && (index < 0 || index >= projects.length)) {
      throw new Error("Invalid project index");
    }

    set({ activeIndex: index });
    refreshActiveProject();
  },

  new(sourceInput, indexHint) {
    const { projects, setActive } = get();
    const source = ProjectSourceSchema.parse(sourceInput) as ProjectSource;
    if (source.kind === 'snapshot') {
      throw new Error('Create snapshot projects from an existing recording.');
    }
    const newProject = createProject(source);

    const targetIndex = indexHint ?? projects.length;
    projects.splice(targetIndex, 0, newProject);

    setActive(targetIndex);

    const connectionId = projectSourceConnectionId(source);
    if (connectionId) newProject.useTransportStore.getState().initialize(connectionId);
  },

  async open(filepath, indexHint) {
    const fileSystemState = getFileSystemState();
    const fileContent = await fileSystemState.readFile(filepath);

    if (!fileContent?.content) {
      throw new Error(`File not found: ${filepath}`);
    }

    const rawContent: unknown = typeof fileContent.content === 'string'
      ? JSON.parse(fileContent.content)
      : decode(new Uint8Array(fileContent.content));
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

    const newProject = createProject(source, filepath, model_identity);
    newProject.useScenarioStore.setState({ mainView, snapshots });
    if (source.kind === 'snapshot') {
      const snapshot = snapshots.find((entry) => entry.metadata.id === source.snapshot_id);
      if (!snapshot) throw new Error(`Snapshot source ${source.snapshot_id} was not found in this project.`);
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

    const { projects, setActive } = get();
    const targetIndex = indexHint ?? projects.length;
    projects.splice(targetIndex, 0, newProject);

    setActive(targetIndex);

    const connectionId = projectSourceConnectionId(source);
    if (connectionId) newProject.useTransportStore.getState().initialize(connectionId, createStateSyncRequestFromStore(scenario));
    return { recovered: warnings.length > 0, warnings };
  },

  async save(index, saveAsPath) {
    const { projects, activeIndex, refreshActiveProject } = get();
    const targetIndex = index ?? activeIndex;

    if (targetIndex == null || targetIndex < 0 || targetIndex >= projects.length) {
      throw new Error("Invalid project index");
    }

    const project = projects[targetIndex];
    const scenarioStore = project.useScenarioStore.getState();
    const projectFile: ProjectFileContent = {
      version: PROJECT_FILE_VERSION,
      mainView: scenarioStore.mainView,
      scenario: scenarioStore.dump(),
      snapshots: scenarioStore.snapshots,
      source: project.source,
      ...(scenarioStore.session.modelIdentity === null ? {} : { model_identity: scenarioStore.session.modelIdentity }),
    };

    const basePath = saveAsPath ?? project.filepath;
    if (!basePath) {
      throw new Error("No file path specified for saving the project");
    }

    const saveFormat = useSettingsStore.getState().saveFormat;
    // Save dialogs return the exact path whose fs scope they authorize. The
    // extension/filter is supplied before the dialog opens; never rewrite it
    // after selection or write through a separately-authorized parent path.
    const filepath = basePath;
    const archive = await archiveProjectFileContentInWorker(projectFile, saveFormat === 'json');

    const fileSystemState = getFileSystemState();
    const content = saveFormat === 'msgpack'
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
    project.useUndoRedoStore.getState().markClean();
    refreshActiveProject();
  },

  openOfflineSnapshot(snapshot, indexHint, frame) {
    const { projects, setActive } = get();
    const sourceSnapshot = snapshotSourceFromFrame(snapshot, frame);
    const identity = sourceSnapshot.metadata.id;
    const source: ProjectSource = { kind: 'snapshot', snapshot_id: identity };
    const project = createProject(source, null, sourceSnapshot.metadata.model_identity);
    project.snapshotPlayback = new SnapshotPlaybackSource(sourceSnapshot);
    project.useScenarioStore.getState().load(sourceSnapshot.initial.scenario);
    project.useScenarioStore.setState({ snapshots: [sourceSnapshot] });
    const targetIndex = indexHint ?? projects.length;
    projects.splice(targetIndex, 0, project);
    setActive(targetIndex);
  },

  close(index) {
    const { projects } = get();

    if (index < 0 || index >= projects.length) {
      throw new Error("Invalid project index");
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

    if (index < 0 || index >= projects.length) {
      throw new Error("Invalid project index");
    }

    const project = projects[index];
    const source = ProjectSourceSchema.parse(nextSource) as ProjectSource;
    if ((source.kind === 'websocket' && project.source.kind === 'websocket' && source.url === project.source.url)
      || (source.kind === 'inmemory' && project.source.kind === 'inmemory' && source.model_id === project.source.model_id)
      || (source.kind === 'snapshot' && project.source.kind === 'snapshot' && source.snapshot_id === project.source.snapshot_id)) {
      return;
    }
    const scenarioStore = project.useScenarioStore.getState();

    if (source.kind === 'snapshot') {
      const snapshot = scenarioStore.snapshots.find((entry) => entry.metadata.id === source.snapshot_id);
      if (!snapshot) throw new Error(`Snapshot source ${source.snapshot_id} was not found in this project.`);
      // Fully materialize the candidate before destroying the current source.
      // From here on every operation consumes a validated in-memory snapshot.
      const playback = new SnapshotPlaybackSource(snapshot);
      const nextScenario = playback.scenario.dump();
      project.useTransportStore.getState().destroy();
      scenarioStore.session.resetSimulatorIdentity();
      scenarioStore.load(nextScenario);
      project.snapshotPlayback = playback;
    } else {
      const connectionId = projectSourceConnectionId(source);
      if (!connectionId) throw new Error('Project source has no transport connection.');
      // changeTransport connects and buffers the candidate before replacing
      // the current transport, so a failure leaves the old source untouched.
      await project.useTransportStore.getState().changeTransport(
        connectionId,
        undefined,
        { resetSimulatorIdentity: true },
      );
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

  project.useTransportStore.getState().destroy();
  project.useScenarioStore.getState().clearAll();
  projects.splice(index, 1);

  const newActiveIndex = activeIndex === null || projects.length === 0
    ? null
    : index < activeIndex
      ? activeIndex - 1
      : index === activeIndex
        ? Math.min(index, projects.length - 1)
        : activeIndex;

  set({ pendingCloseProjectId: null });
  setActive(newActiveIndex);
}
