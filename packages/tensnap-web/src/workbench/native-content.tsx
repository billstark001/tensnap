import { runWorkbenchCommand, type WorkbenchCommand } from './commands';
import { createAgentInspectionSource } from './agent-inspection-source';
import { createTransportStore } from '../store/transport';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@lingui/react';
import { i18n, initI18n } from '../i18n';
import { Scenario } from '@tensnap/core';
import { RendererSession } from '@tensnap/core/runtime';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import { dialogContent, reactContent } from '@tensnap/web-common/workbench/dialog-content';
import { configureDialogHost, mountContent } from '@tensnap/web-common/workbench/content';
import { useProjectStore, type ProjectContextScheme } from '../store/project';
import { createScenarioStore, ScenarioStoreProvider } from '../store/scenario/store';
import { useSettingsStore } from '../store/settings';
import { createHistoryStore, ScenarioUndoRedoStoreProvider } from '../store/undo-redo';
import { ToastAnchor } from '../store/toast';
// Register content by stable IDs; no serialized component code crosses windows.
import '../dialogs/AboutDialog';
import '../dialogs/AgentDetailsDialog';
import '../dialogs/ContinuousRunDialog';
import '../dialogs/CreateNewProjectDialog';
import '../dialogs/SceneRestoreDialog';
import '../dialogs/SelectRecordingDialog';
import '../dialogs/SettingsDialog';
import '../dialogs/SimulatorInfoDialog';
import '../dialogs/SnapshotDetailDialog';
import '../dialogs/edit-views/EditViewDialog';
import '../dialogs/edit-views/EditObjectIdDialog';
import '../dialogs/edit-views/ConfirmEditDialog';
import '@tensnap/web-common/components/ui/AlertDialog';

type Encoded = unknown;
export interface ContentRpc {
  call(method: string, args: unknown[]): Promise<unknown>;
}

/** Scope callback IDs and native objects to one owned content instance. */
export class ContentCodec {
  private callbacks = new Map<string, (...args: any[]) => unknown>();
  private remoteCallbacks = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  private signalListeners = new Map<string, () => void>();
  private controllers = new Map<string, AbortController>();
  constructor(private rpc?: ContentRpc) {}
  encode(value: unknown, key = 'props'): Encoded {
    if (typeof value === 'function') {
      this.callbacks.set(key, value as (...args: any[]) => unknown);
      return { $content: 'callback', key };
    }
    if (value instanceof AbortSignal) {
      const id = crypto.randomUUID();
      const abort = () => {
        void this.rpc!.call('abort', [id]).catch(() => {});
      };
      value.addEventListener('abort', abort, { once: true });
      this.signalListeners.set(key, () => value.removeEventListener('abort', abort));
      return { $content: 'signal', id, aborted: value.aborted };
    }
    if (value instanceof RendererSession)
      return {
        $content: 'session',
        scene: this.encode(value.scenario.dump(), `${key}.scene`),
        isConnected: value.isConnected,
        simulatorInfo: value.simulatorInfo,
        restoreScene: this.encode(value.restoreScene.bind(value), `${key}.restoreScene`),
      };
    if (value instanceof Scenario)
      return { $content: 'scenario', scene: this.encode(value.dump(), `${key}.scene`) };
    if (value instanceof Uint8Array) return { $content: 'bytes', data: Array.from(value) };
    if (value instanceof Map)
      return {
        $content: 'map',
        entries: Array.from(value, ([k, v], i) => [
          this.encode(k, `${key}.${i}.key`),
          this.encode(v, `${key}.${i}.value`),
        ]),
      };
    if (value instanceof Set)
      return {
        $content: 'set',
        values: Array.from(value, (v, i) => this.encode(v, `${key}.${i}`)),
      };
    if (isValidElement(value))
      return {
        $content: 'html',
        html: renderToStaticMarkup(createElement(I18nProvider, { i18n }, value)),
      };
    if (Array.isArray(value)) return value.map((v, i) => this.encode(v, `${key}.${i}`));
    if (value && typeof value === 'object') {
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      )
        throw new Error(`Unsupported content service at ${key}`);
      return {
        $content: 'object',
        entries: Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, this.encode(v, `${key}.${k}`)]),
        ),
      };
    }
    return value;
  }
  decode(value: any, signals?: Set<string>): any {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => this.decode(v, signals));
    switch (value.$content) {
      case 'object':
        return Object.fromEntries(
          Object.entries(value.entries).map(([k, v]) => [k, this.decode(v, signals)]),
        );
      case 'bytes':
        return new Uint8Array(value.data);
      case 'map':
        return new Map(
          value.entries.map(([k, v]: any[]) => [this.decode(k, signals), this.decode(v, signals)]),
        );
      case 'set':
        return new Set(value.values.map((v: unknown) => this.decode(v, signals)));
      case 'callback': {
        let callback = this.remoteCallbacks.get(value.key);
        if (!callback) {
          callback = (...args: unknown[]) => {
            const request = `call.${crypto.randomUUID()}`;
            return this.rpc!.call('callback', [value.key, this.encode(args, request)])
              .then((result) => this.decode(result))
              .finally(() => {
                for (const [key, remove] of this.signalListeners)
                  if (key.startsWith(request + '.')) {
                    remove();
                    this.signalListeners.delete(key);
                  }
              });
          };
          this.remoteCallbacks.set(value.key, callback);
        }
        return callback;
      }
      case 'signal': {
        const controller = new AbortController();
        if (value.aborted) controller.abort();
        this.controllers.set(value.id, controller);
        signals?.add(value.id);
        return controller.signal;
      }
      case 'scenario': {
        const scene = new Scenario();
        scene.load(this.decode(value.scene));
        return scene;
      }
      case 'session':
        return {
          scenario: this.decode({ $content: 'scenario', scene: value.scene }),
          isConnected: value.isConnected,
          simulatorInfo: value.simulatorInfo,
          restoreScene: this.decode(value.restoreScene),
        };
      case 'html':
        return createElement('span', { dangerouslySetInnerHTML: { __html: value.html } });
      default:
        throw new Error('Unknown content encoding.');
    }
  }
  async invoke(method: string, args: any[]): Promise<unknown> {
    if (method === 'abort') {
      this.controllers.get(args[0])?.abort();
      this.controllers.delete(args[0]);
      return;
    }
    if (method !== 'callback') throw new Error(`Unknown content command: ${method}`);
    const callback = this.callbacks.get(args[0]);
    if (!callback) throw new Error('The content callback is no longer available.');
    const signals = new Set<string>();
    try {
      const result = await callback(...this.decode(args[1], signals));
      return this.encode(result, `result.${args[0]}`);
    } finally {
      signals.forEach((key) => this.controllers.delete(key));
    }
  }
  dispose() {
    this.signalListeners.forEach((remove) => remove());
    this.signalListeners.clear();
    this.controllers.forEach((controller) => controller.abort());
    this.controllers.clear();
    this.callbacks.clear();
    this.remoteCallbacks.clear();
  }
}

export interface ContentState {
  contentId: string;
  propsVersion: number;
  props: Encoded;
  settings: Encoded;
  project?: {
    id: string;
    source: ProjectContextScheme['source'];
    filepath: string | null;
    scene?: Encoded;
    snapshots: Encoded;
    mainView: Encoded;
    actions: Encoded;
    commands: Encoded;
  };
}
export function contentOwner(contentId: string, initialProps: object) {
  const project = useProjectStore.getState().activeProject;
  const codec = new ContentCodec();
  let props = initialProps;
  let propsVersion = 0;
  const inspectorProps = initialProps as {
    scenario?: Scenario;
    agentRef?: import('@tensnap/core').AgentRef;
  };
  const inspection =
    contentId === 'AgentDetailsDialog' && inspectorProps.scenario && inspectorProps.agentRef
      ? createAgentInspectionSource(inspectorProps.scenario, inspectorProps.agentRef)
      : undefined;
  const projectIndex = () => {
    const index = useProjectStore
      .getState()
      .projects.findIndex((entry) => entry.id === project?.id);
    if (index < 0) throw new Error('The owner project has been closed.');
    return index;
  };
  const commands = {
    changeSource: (_index: number, source: ProjectContextScheme['source']) =>
      useProjectStore.getState().changeSource(projectIndex(), source),
  };
  return {
    codec,
    isAlive() {
      return (
        !project || useProjectStore.getState().projects.some((entry) => entry.id === project.id)
      );
    },
    menu(command: WorkbenchCommand) {
      return runWorkbenchCommand(command, project?.id ?? null);
    },
    update(next: object) {
      if (project && useProjectStore.getState().activeProject?.id !== project.id) return false;
      if (inspection) return false;
      const changed = Object.entries(next).some(
        ([key, value]) =>
          typeof value !== 'function' && value !== (props as Record<string, unknown>)[key],
      );
      props = next;
      if (changed) propsVersion++;
      return changed;
    },
    state(): ContentState {
      if (project) projectIndex();
      const settings = useSettingsStore.getState();
      const scenario = project?.useScenarioStore.getState();
      const contentProps = inspection
        ? {
            ...props,
            scenario: undefined,
            resolveAssetUrl: undefined,
            inspectionSource: { read: inspection.read },
          }
        : props;
      return {
        contentId,
        propsVersion,
        props: codec.encode(contentProps),
        settings: codec.encode(settings, 'settings'),
        ...(!inspection && project && scenario
          ? {
              project: {
                id: project.id,
                source: project.source,
                filepath: project.filepath,
                ...(contentId === 'EditViewDialog'
                  ? {
                      scene: codec.encode(
                        scenario.scenario.dump({
                          includeCharts: true,
                          includeLogs: false,
                          includeAssets: false,
                        }),
                        'scene',
                      ),
                    }
                  : {}),
                snapshots: codec.encode(
                  contentId === 'SettingsDialog' ? scenario.snapshots : [],
                  'snapshots',
                ),
                mainView: codec.encode(scenario.mainView, 'mainView'),
                commands: codec.encode(commands, 'projectCommands'),
                actions: codec.encode(
                  Object.fromEntries(
                    Object.entries(scenario).filter(([, value]) => typeof value === 'function'),
                  ),
                  'actions',
                ),
              },
            }
          : {}),
      };
    },
    subscribe(changed: () => void) {
      const stops = [useSettingsStore.subscribe(changed), useProjectStore.subscribe(changed)];
      if (project) {
        stops.push(
          project.useTransportStore.subscribe(() => {
            propsVersion++;
            changed();
          }),
        );
        if (contentId === 'EditViewDialog') stops.push(project.useScenarioStore.subscribe(changed));
        if (contentId === 'SimulatorInfoDialog')
          stops.push(
            project.useScenarioStore.subscribe(() => {
              propsVersion++;
              changed();
            }),
          );
      }
      return () => stops.forEach((stop) => stop());
    },
    dispose() {
      inspection?.dispose();
      codec.dispose();
    },
  };
}

/** A child owns a local projected scene for rendering, and proxies mutations to its owner. */
export function mountNativeContent(host: HTMLElement, initial: ContentState, rpc: ContentRpc) {
  const codec = new ContentCodec(rpc);
  const history = createHistoryStore({ maxCommands: 64, maxBytes: 4 * 1024 * 1024 });
  const scenario = createScenarioStore(history);
  const loadLocalScene = scenario.getState().load;
  const transport = createTransportStore(scenario);
  configureDialogHost({
    create(options) {
      const element = document.createElement('section');
      element.className = 'content-island';
      element.tabIndex = -1;
      element.setAttribute('role', options.dismissible ? 'dialog' : 'alertdialog');
      document.body.append(element);
      const key = (event: KeyboardEvent) => {
        if (
          event.key === 'Escape' &&
          options.dismissible &&
          !document.querySelector('[data-workbench-menu]')
        )
          options.onClose();
      };
      const requestClose = () => {
        if (options.dismissible) options.onClose();
      };
      document.addEventListener('content-close-request', requestClose);
      element.addEventListener('keydown', key);
      return {
        element,
        update(next) {
          options = next;
        },
        dispose() {
          document.removeEventListener('content-close-request', requestClose);
          element.removeEventListener('keydown', key);
          element.remove();
        },
      };
    },
  });
  const definition = reactContent(dialogContent(initial.contentId), (content: ReactNode) =>
    createElement(
      I18nProvider,
      { i18n },
      createElement(
        ScenarioStoreProvider,
        { value: scenario },
        createElement(ScenarioUndoRedoStoreProvider, { value: history }, content),
      ),
      createElement(ToastAnchor),
    ),
  );
  let content: ReturnType<typeof definition.mount> | undefined;
  let propsVersion = -1;
  let props: any;
  const update = (state: ContentState) => {
    const settings = codec.decode(state.settings);
    useSettingsStore.setState(settings);
    document.body.dataset.theme = settings.theme;
    void initI18n(settings.locale);
    if (state.project) {
      if (state.project.scene)
        loadLocalScene(codec.decode(state.project.scene) as ScenarioSnapshot);
      scenario.setState({
        snapshots: codec.decode(state.project.snapshots),
        mainView: codec.decode(state.project.mainView),
        ...codec.decode(state.project.actions),
      });
      const project: ProjectContextScheme = {
        id: state.project.id,
        source: state.project.source,
        filepath: state.project.filepath,
        useScenarioStore: scenario,
        useTransportStore: transport,
        useUndoRedoStore: history,
      };
      useProjectStore.setState({
        projects: [project],
        activeIndex: 0,
        activeProject: project,
        ...codec.decode(state.project.commands),
      });
    }
    if (propsVersion !== state.propsVersion) {
      props = codec.decode(state.props);
      propsVersion = state.propsVersion;
    }
    if ('resolveAssetUrl' in props && !props.inspectionSource)
      props.resolveAssetUrl = (id: string) => scenario.getState().scenario.assets.getUrl(id);
    if (content) content.update(props);
    else content = mountContent(definition, host, props);
  };
  update(initial);
  return {
    update,
    dispose() {
      content?.dispose();
      codec.dispose();
      scenario.getState().session.destroy();
    },
  };
}
