import { create, StoreApi, UseBoundStore } from "zustand";
import { createTransportStore, TransportStore } from "./transport";
import { generateUniqueId } from "@/utils/common";
import {
  archiveProjectFileContentInWorker,
  parseProjectFileContent,
  PROJECT_FILE_VERSION,
  recoverProjectFileContent,
  type ProjectFileContent,
} from "@/types/project";
import { decode, encode } from "@msgpack/msgpack";
import { ChartGroup, ChartMetadata } from "@/types/model";
import { createHistoryStore, type HistoryState } from "./undo-redo";
import { useSettingsStore } from "./settings";
import { checkMsgpackCompatibility, uint8ArrayToArrayBuffer } from "@/utils/msgpack";
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import { materializeSnapshot, type Snapshot } from '@tensnap/core/snapshot';
import type { StateSyncRequest } from '@tensnap/protocol';
import { createScenarioStore, ScenarioStore } from "./scenario/store";
import { getFileSystemState } from "./file-system/provider";
import { getToastState } from './toast';

export interface ProjectSettings {
  url: string;
}

export interface ProjectOpenResult {
  recovered: boolean;
  warnings: string[];
}

export interface ProjectContextScheme extends ProjectSettings {
  id: string;
  filepath: string | null;
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>;
  useTransportStore: UseBoundStore<StoreApi<TransportStore>>;
  useUndoRedoStore: UseBoundStore<StoreApi<HistoryState>>;
}

function projectTabName(project: ProjectContextScheme): string {
  if (!project.filepath) return project.url;
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

export const createStateSyncRequestFromStore = (store?: ScenarioSnapshot): StateSyncRequest => {
  const { parameters = [], actions = [], environments = [], charts = [] } = store || {};
  return {
    parameters,
    actions,
    envs: environments.map(env => ({
      id: env.id,
      type: env.type,
      layers: env.layers.map(layer => ({ layer_id: layer.id, layer_type: layer.layerType })),
    })),
    charts: getAllChartMetadata(charts),
  };
};

const createProject = (url: string, filepath: string | null = null): ProjectContextScheme => {
  const useUndoRedoStore = createHistoryStore({
    maxCommands: 64,
    maxBytes: 4 * 1024 * 1024,
    onError: (error, command) => getToastState().error(
      `Unable to ${command.label}`,
      error instanceof Error ? error.message : String(error),
    ),
  });
  const useScenarioStore = createScenarioStore(useUndoRedoStore);
  const useTransportStore = createTransportStore(useScenarioStore);

  return {
    id: generateUniqueId(),
    filepath,
    url,
    useScenarioStore,
    useTransportStore,
    useUndoRedoStore,
  };
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

  setActive: (index: number | null) => void;
  refreshActiveProject: () => void;

  new: (url: string, indexHint?: number) => void;
  open: (filepath: string, indexHint?: number) => Promise<ProjectOpenResult>;
  save: (index?: number, saveAsPath?: string) => Promise<void>;
  close: (index: number) => void;
  changeUrl: (index: number, newUrl: string) => Promise<void>;
  openOfflineSnapshot: (snapshot: Snapshot, indexHint?: number) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeIndex: null,
  activeProject: null,
  activeFilepath: null,
  tabs: [],

  refreshActiveProject() {
    const { projects, activeIndex } = get();
    set({
      tabs: projects.map(project => ({
        id: project.id,
        name: projectTabName(project),
        title: project.filepath ?? project.url,
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

  new(url, indexHint) {
    const { projects, setActive } = get();
    const newProject = createProject(url);

    const targetIndex = indexHint ?? projects.length;
    projects.splice(targetIndex, 0, newProject);

    setActive(targetIndex);

    newProject.useTransportStore.getState().initialize(url);
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

    const { scenario, mainView, url, snapshots } = parsedContent;

    const newProject = createProject(url, filepath);
    newProject.useScenarioStore.setState({ mainView, snapshots });
    newProject.useScenarioStore.getState().load(scenario);

    const { projects, setActive } = get();
    const targetIndex = indexHint ?? projects.length;
    projects.splice(targetIndex, 0, newProject);

    setActive(targetIndex);

    if (url) {
      newProject.useTransportStore.getState().initialize(url, createStateSyncRequestFromStore(scenario));
    }
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
    const connectionId = project.useTransportStore.getState().connectionId;

    const projectFile: ProjectFileContent = {
      version: PROJECT_FILE_VERSION,
      mainView: scenarioStore.mainView,
      scenario: scenarioStore.dump(),
      snapshots: scenarioStore.snapshots,
      url: connectionId ?? project.url,
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
    console.log('Project saved to', filepath);

    project.filepath = filepath;
    project.useUndoRedoStore.getState().markClean();
    refreshActiveProject();
  },

  openOfflineSnapshot(snapshot, indexHint) {
    const { projects, setActive } = get();
    const identity = snapshot.metadata.id;
    const project = createProject(`offline:${identity}`);
    project.useScenarioStore.getState().load(materializeSnapshot(snapshot));
    project.useScenarioStore.setState({ snapshots: [structuredClone(snapshot)] });
    const targetIndex = indexHint ?? projects.length;
    projects.splice(targetIndex, 0, project);
    setActive(targetIndex);
  },

  close(index) {
    const { projects, activeIndex, setActive } = get();

    if (index < 0 || index >= projects.length) {
      throw new Error("Invalid project index");
    }

    const history = projects[index].useUndoRedoStore.getState();
    if (history.isDirty() && typeof globalThis.confirm === 'function') {
      const confirmed = globalThis.confirm('Close this project and discard renderer edits that have not been saved?');
      if (!confirmed) return;
    }

    projects[index].useTransportStore.getState().destroy();
    projects[index].useScenarioStore.getState().clearAll();

    projects.splice(index, 1);

    const newActiveIndex = activeIndex === null || activeIndex < projects.length
      ? activeIndex
      : projects.length > 0
        ? projects.length - 1
        : null;

    setActive(newActiveIndex);
  },

  async changeUrl(index, newUrl) {
    const { projects } = get();

    if (index < 0 || index >= projects.length) {
      throw new Error("Invalid project index");
    }

    const project = projects[index];
    const scenarioState = project.useScenarioStore.getState().dump();
    const stateSyncRequest = createStateSyncRequestFromStore(scenarioState);

    await project.useTransportStore.getState().changeTransport(newUrl, stateSyncRequest);

    // 更新项目的 URL 属性
    project.url = newUrl;
  },
}));
