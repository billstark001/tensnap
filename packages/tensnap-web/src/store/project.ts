import { create, StoreApi, UseBoundStore } from "zustand";
import { createScenarioStore, ScenarioStore } from "./scenario";
import { createWebSocketStore, WebSocketStore } from "./websocket";
import { FileSystemState } from "./file-system/store";
import { generateUniqueId } from "@/utils/common";
import { ProjectFileContent } from "@/types/project";
import { decode, encode } from "@msgpack/msgpack";
import { ChartGroup, ChartMetadata, Environment, EnvironmentId, PureEnvironment, SimulationState } from "@/types/model";
import { createUndoRedoStore, UndoRedoState } from "./undo-redo";
import { useSettingsStore } from "./settings";
import { checkMsgpackCompatibility, uint8ArrayToArrayBuffer } from "@/utils/msgpack";
import { InstantiatedChartDataStorage, InstantiatedEnvironment, instantiateEnvironment, serializeEnvironment } from "@/store/scenario-inst";
import { StateSyncRequest } from "@/types/api";

export interface ProjectSettings {
  url: string;
}

export interface ProjectContextScheme extends ProjectSettings {
  id: string;
  filepath: string | null;

  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>;
  useWebSocketStore: UseBoundStore<StoreApi<WebSocketStore>>;
  useUndoRedoStore: UseBoundStore<StoreApi<UndoRedoState<ScenarioStore>>>;
}

const insertProject = (projects: readonly Readonly<ProjectContextScheme>[], newProject: ProjectContextScheme, indexHint?: number) => {
  const newProjects = [...projects];
  let activeIndex: number;
  if (indexHint != null) {
    newProjects.splice(indexHint, 0, newProject);
    activeIndex = indexHint;
  } else {
    newProjects.push(newProject);
    activeIndex = newProjects.length - 1;
  }
  return { newProjects, activeIndex };
};


const getPureEnvironment = ({ agents, ...rest }: Environment) => (rest as PureEnvironment);


const getAllChartMetadata = (chartGroups: ChartGroup[]): ChartMetadata[] => {
  const allMetadata: ChartMetadata[] = [];
  const metadataIdSet = new Set<string>();
  for (const { metadataDict: metadataList } of chartGroups) {
    for (const metadata of Object.values(metadataList)) {
      if (!metadataIdSet.has(metadata.id)) {
        allMetadata.push(metadata);
        metadataIdSet.add(metadata.id);
      }
    }
  }
  return allMetadata;
};

export const createStateSyncRequestFromStore = (store?: SimulationState): StateSyncRequest => {
  const { parameters = [], environments = [], charts = [] } = store || {};
  return {
    parameters,
    environments: environments.map(getPureEnvironment),
    charts: getAllChartMetadata(charts),
  };
};


export interface ProjectStore {

  fileSystemStore: UseBoundStore<StoreApi<FileSystemState>> | null;

  projects: readonly Readonly<ProjectContextScheme>[];

  activeIndex: number | null;

  setFileSystemStore: (fsStore: UseBoundStore<StoreApi<FileSystemState>>) => void;

  getActive: () => Readonly<ProjectContextScheme> | null;
  setActive: (index: number | null) => void;

  getDisplayNames: () => { id: string; name: string; }[];

  new: (url: string, indexHint?: number) => void;
  open: (filepath: string, indexHint?: number) => Promise<void>;
  save: (index?: number, saveAsPath?: string) => Promise<void>;
  close: (index: number) => void;

}

export const useProjectStore = create<ProjectStore>((set, get) => ({

  fileSystemStore: null,

  projects: [],
  activeIndex: null,

  getDisplayNames() {
    const { projects } = get();
    return projects.map(project => ({
      id: project.id,
      name: project.filepath ?? project.url,
    }));
  },

  getActive() {
    const { activeIndex, projects } = get();
    if (activeIndex === null) return null;
    return projects[activeIndex];
  },

  setActive(index) {
    const { projects } = get();
    if (index !== null && (index < 0 || index >= projects.length)) {
      throw new Error("Invalid project index");
    }
    set({ activeIndex: index });
  },

  setFileSystemStore(fsStore) {
    set({ fileSystemStore: fsStore });
  },

  new(url, indexHint) {
    const { projects } = get();
    const useScenarioStore = createScenarioStore();
    const useWebSocketStore = createWebSocketStore(useScenarioStore);
    const useUndoRedoStore = createUndoRedoStore(64, useScenarioStore);

    const newProject: ProjectContextScheme = {
      id: generateUniqueId(),
      filepath: null,
      url,
      useScenarioStore,
      useWebSocketStore,
      useUndoRedoStore,
    };

    const { newProjects, activeIndex } = insertProject(projects, newProject, indexHint);

    set({
      projects: newProjects,
      activeIndex: activeIndex,
    });

    useWebSocketStore.getState().initialize(url);
  },

  async open(filepath, indexHint) {
    const { fileSystemStore } = get();
    if (!fileSystemStore) {
      throw new Error("File system store is not initialized");
    }

    const fileSystemState = fileSystemStore.getState();
    const { content } = await fileSystemState.loadFile(filepath) ?? {};
    if (!content) {
      throw new Error(`File not found: ${filepath}`);
    }

    const parsedContent: ProjectFileContent = typeof content === 'string'
      ? JSON.parse(content)
      : decode(new Uint8Array(content));

    const useScenarioStore = createScenarioStore();
    const useWebSocketStore = createWebSocketStore(useScenarioStore);
    const useUndoRedoStore = createUndoRedoStore(64, useScenarioStore);

    const { environments, charts, ...rest } = parsedContent.scenario;

    const instantiatedEnvironments: Map<EnvironmentId, InstantiatedEnvironment> = new Map();
    for (const env of environments) {
      instantiatedEnvironments.set(env.id, instantiateEnvironment(env));
    }

    useScenarioStore.setState({
      mainView: parsedContent.mainView,
      ...rest,
      environments: instantiatedEnvironments,
      charts: new InstantiatedChartDataStorage(charts),
    });

    const { url } = parsedContent || null;
    const { projects } = get();
    const newProject: ProjectContextScheme = {
      id: generateUniqueId(),
      filepath,
      url,
      useScenarioStore,
      useWebSocketStore,
      useUndoRedoStore,
    };

    const { newProjects, activeIndex } = insertProject(projects, newProject, indexHint);

    set({
      projects: newProjects,
      activeIndex: activeIndex,
    });

    useWebSocketStore.getState().initialize(url, createStateSyncRequestFromStore(parsedContent.scenario));
  },

  async save(index, saveAsPath) {
    const { projects, activeIndex } = get();
    index ??= activeIndex ?? undefined;
    if (index == null || index < 0 || index >= projects.length) {
      throw new Error("Invalid project index");
    }
    const { fileSystemStore } = get();
    if (!fileSystemStore) {
      throw new Error("File system store is not initialized");
    }

    const project = projects[index];
    const fileSystemState = fileSystemStore.getState();

    // pack the scenario

    const scenarioStore = project.useScenarioStore.getState();
    const scenarioDump: SimulationState = {
      connected: false,
      currentTime: scenarioStore.currentTime,
      environments: Array.from(scenarioStore.environments.values()).map(env => serializeEnvironment(env)),
      parameters: scenarioStore.parameters,
      charts: scenarioStore.charts.getGroups(),
      snapshots: scenarioStore.snapshots,
    };
    const mainView = scenarioStore.mainView;
    const url = project.useWebSocketStore.getState().url ?? '';

    const projectFile: ProjectFileContent = {
      mainView,
      scenario: scenarioDump,
      url: typeof url === 'string' ? url : 'ws://fake-url',
    };

    // determine path

    saveAsPath ??= project.filepath ?? undefined;
    if (!saveAsPath) {
      throw new Error("No file path specified for saving the project");
    }

    const { saveFormat: saveFormatSetting } = useSettingsStore.getState();
    const saveFormatFromFile = saveAsPath?.endsWith('json') ? 'json'
      : saveAsPath?.endsWith('msgpack') ? 'msgpack'
        : undefined;

    const projectFilepath = saveFormatFromFile == null
      ? `${saveAsPath}.${saveFormatSetting}`
      : saveAsPath;

    const saveFormat = saveFormatFromFile ?? saveFormatSetting;
    // save

    if (saveFormat === 'msgpack') {
      checkMsgpackCompatibility(projectFile);
      const buffer = encode(projectFile);
      await fileSystemState.writeFile(projectFilepath, uint8ArrayToArrayBuffer(buffer));
    } else {
      await fileSystemState.writeFile(projectFilepath, JSON.stringify(projectFile));
    }
    console.log('Project saved to', projectFilepath);

    // update project file path
    const newProject = {
      ...project,
      filepath: projectFilepath,
    };
    set({
      projects: [...projects.slice(0, index), newProject, ...projects.slice(index + 1)],
    });
  },

  close(index) {
    // close without save
    const { projects, activeIndex } = get();
    if (index < 0 || index >= projects.length) {
      throw new Error("Invalid project index");
    }

    const useWebSocketStore = projects[index].useWebSocketStore;
    useWebSocketStore.getState().destroy();

    const newProjects = [...projects];
    newProjects.splice(index, 1);

    let newActiveIndex: number | null = null;
    if (activeIndex !== null && activeIndex >= newProjects.length) {
      newActiveIndex = newProjects.length > 0 ? newProjects.length - 1 : null;
    } else {
      newActiveIndex = activeIndex;
    }

    set({
      projects: newProjects,
      activeIndex: newActiveIndex,
    });
  },
}));