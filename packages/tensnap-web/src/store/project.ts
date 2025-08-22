import { create, StoreApi, UseBoundStore } from "zustand";
import { createScenarioStore, ScenarioStore } from "./scenario";
import { createWebSocketStore, WebSocketStore } from "./websocket";
import { FileSystemState } from "./file-system/store";
import { generateUniqueId } from "@/components/view/utils/common";
import { ProjectFileContent } from "@/types/project";
import { decode, encode } from "@msgpack/msgpack";
import { SimulationState } from "@/types/modeling";
import { createUndoRedoStore, UndoRedoState } from "./undo-redo";
import { useSettingsStore } from "./settings";

export interface ProjectContextScheme {
  id: string;
  filepath: string | null;
  url: string;

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
  save: (index?: number) => Promise<void>;
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
      : decode(content);

    const useScenarioStore = createScenarioStore();
    const useWebSocketStore = createWebSocketStore(useScenarioStore);
    const useUndoRedoStore = createUndoRedoStore(64, useScenarioStore);

    useScenarioStore.setState({
      mainView: parsedContent.mainView,
      ...parsedContent.scenario,
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

    useWebSocketStore.getState().initialize(url);
  },

  async save(index) {
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
      environments: scenarioStore.environments,
      parameters: scenarioStore.parameters,
      charts: scenarioStore.charts,
      snapshots: scenarioStore.snapshots,
    };
    const mainView = scenarioStore.mainView;
    const url = project.useWebSocketStore.getState().url ?? '';

    const projectFile: ProjectFileContent = {
      mainView,
      scenario: scenarioDump,
      url,
    };

    // determine path

    const { saveFormat: saveFormatSetting } = useSettingsStore.getState();
    const saveFormatFromFile = project.filepath?.endsWith('json') ? 'json'
      : project.filepath?.endsWith('msgpack') ? 'msgpack'
      : undefined;

    const projectFilepath = saveFormatFromFile == null
      ? `${project.filepath}.${saveFormatSetting}`
      : project.filepath!;

    const saveFormat = saveFormatFromFile ?? saveFormatSetting;

    // save

    if (saveFormat === 'msgpack') {
      const buffer = encode(projectFile);
      await fileSystemState.writeFile(projectFilepath, buffer.buffer as ArrayBuffer);
    } else {
      await fileSystemState.writeFile(projectFilepath, JSON.stringify(projectFile));
    }
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