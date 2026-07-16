
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectStore } from './project';
import { getFileSystemState } from './file-system/provider';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { uint8ArrayToArrayBuffer } from '@tensnap/core/utils';
import { decode, encode } from '@msgpack/msgpack';
import { archiveProjectFileContent, parseProjectFileContent, PROJECT_FILE_VERSION, recoverProjectFileContent } from '@/types/project';

const mockedSettings = vi.hoisted(() => ({ saveFormat: 'json' as 'json' | 'msgpack' }));

const emptyScenario = () => ({
  metadata: {},
  actions: [],
  parameters: [],
  environments: [],
  charts: [],
  monitors: [],
  logs: [],
  assets: [],
});

const mainView = {
  id: 'root',
  type: 'container' as const,
  left: 0,
  top: 0,
  width: 800,
  height: 600,
  expanded: true,
  disabled: false,
  data: { title: 'Main' },
  views: [],
};

vi.mock('./file-system/provider', () => ({
  getFileSystemState: vi.fn(),
}));

vi.mock('./settings', () => ({
  useSettingsStore: {
    getState: () => mockedSettings,
  },
}));

describe('ProjectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      activeIndex: null,
      activeProject: null,
      activeFilepath: null,
    });
    mockedSettings.saveFormat = 'json';
    vi.clearAllMocks();
  });

  it('should include snapshots when saving a project', async () => {
    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    (getFileSystemState as any).mockReturnValue({
      writeFile: mockWriteFile,
      createDirectory: vi.fn().mockResolvedValue(undefined),
    });

    // Setup a project with snapshots
    const store = useProjectStore.getState();
    store.new({ kind: 'websocket', url: 'ws://localhost:8080' });

    const activeProject = useProjectStore.getState().activeProject!;
    activeProject.useScenarioStore.getState().session.setExpectedSimulatorIdentity({
      model_id: 'saved-model',
      state_schema_version: '2',
      instance_id: 'saved-instance',
    });

    // Add a dummy snapshot
    const dummySnapshot = createSingleSnapshot({
      metadata: {},
      actions: [],
      parameters: [],
      environments: [],
      charts: [],
      monitors: [],
      logs: [],
      assets: [],
    }, { id: 'snapshot-1' });

    activeProject.useScenarioStore.setState({
      snapshots: [dummySnapshot]
    });
    activeProject.useScenarioStore.getState().setMainView({
      ...activeProject.useScenarioStore.getState().mainView,
      width: 901,
    });
    expect(activeProject.useUndoRedoStore.getState().isDirty()).toBe(true);

    // Save the project
    await useProjectStore.getState().save(0, '/test/project.json');

    expect(mockWriteFile).toHaveBeenCalled();
    const savedContent = JSON.parse(mockWriteFile.mock.calls[0][1]);

    // This is expected to FAIL currently as snapshots are not included
    expect(savedContent).toHaveProperty('snapshots');
    expect(savedContent.snapshots).toHaveLength(1);
    expect(savedContent.snapshots[0].metadata.id).toBe('snapshot-1');
    expect(savedContent.version).toBe(3);
    expect(savedContent.source).toEqual({ kind: 'websocket', url: 'ws://localhost:8080' });
    expect(savedContent.model_identity).toEqual({
      model_id: 'saved-model',
      state_schema_version: '2',
      instance_id: 'saved-instance',
    });
    expect(savedContent.snapshots[0].segments).toHaveLength(1);
    expect(activeProject.useUndoRedoStore.getState().isDirty()).toBe(false);
    expect(useProjectStore.getState().tabs).toEqual([
      expect.objectContaining({ name: 'project.json', title: '/test/project.json' }),
    ]);
  });

  it('migrates legacy one-off snapshots and defaults missing legacy snapshots to an empty list', async () => {
    const legacySnapshot = emptyScenario();
    const legacyRecording = createSingleSnapshot(legacySnapshot, { id: 'legacy-recording' });
    (getFileSystemState as any).mockReturnValue({
      readFile: vi.fn()
        .mockResolvedValueOnce({ content: JSON.stringify({
          url: 'http://legacy.example',
          mainView,
          scenario: emptyScenario(),
          snapshots: [legacySnapshot],
        }) })
        .mockResolvedValueOnce({ content: JSON.stringify({
          url: 'http://legacy-empty.example',
          mainView,
          scenario: emptyScenario(),
        }) })
        .mockResolvedValueOnce({ content: uint8ArrayToArrayBuffer(encode({
          url: 'http://legacy-recording.example',
          mainView,
          scenario: emptyScenario(),
          snapshots: [legacyRecording],
        })) }),
    });

    await useProjectStore.getState().open('/legacy.json');
    const migrated = useProjectStore.getState().projects[0].useScenarioStore.getState().snapshots;
    expect(migrated).toHaveLength(1);
    expect(migrated[0]).toMatchObject({
      version: 1,
      initial: { frame: 0, scenario: legacySnapshot },
      frames: [],
    });

    await useProjectStore.getState().open('/legacy-without-snapshots.json');
    expect(useProjectStore.getState().projects[1].useScenarioStore.getState().snapshots).toEqual([]);

    await useProjectStore.getState().open('/legacy-recording.msgpack');
    expect(useProjectStore.getState().projects[2].useScenarioStore.getState().snapshots)
      .toMatchObject([{ metadata: { id: 'legacy-recording' }, initial: { scenario: legacySnapshot } }]);
  });

  it('honors the v1 and v2 project migration promise and normalizes both to v3', () => {
    const recording = createSingleSnapshot(emptyScenario(), { id: 'legacy-recording' });
    const versionOne = parseProjectFileContent({
      version: 1,
      url: 'inmemory:legacy-v1',
      mainView,
      scenario: emptyScenario(),
      snapshots: [recording],
    });
    expect(versionOne).toMatchObject({
      version: PROJECT_FILE_VERSION,
      source: { kind: 'inmemory', model_id: 'legacy-v1' },
      snapshots: [{ metadata: { id: 'legacy-recording' } }],
    });
    expect(archiveProjectFileContent(versionOne)).toMatchObject({
      version: PROJECT_FILE_VERSION,
      source: { kind: 'inmemory', model_id: 'legacy-v1' },
    });

    const currentArchive = archiveProjectFileContent({
      version: PROJECT_FILE_VERSION,
      source: { kind: 'websocket', url: 'ws://unused-current-source' },
      mainView,
      scenario: emptyScenario(),
      snapshots: [recording],
    });
    const versionTwo = parseProjectFileContent({
      ...currentArchive,
      version: 2,
      url: 'ws://legacy-v2.example',
    });
    expect(versionTwo).toMatchObject({
      version: PROJECT_FILE_VERSION,
      source: { kind: 'websocket', url: 'ws://legacy-v2.example' },
      snapshots: [{ metadata: { id: 'legacy-recording' } }],
    });

    const versionOneWebSocket = parseProjectFileContent({
      version: 1,
      url: 'http://legacy-v1.example',
      mainView,
      scenario: emptyScenario(),
      snapshots: [recording],
    });
    expect(versionOneWebSocket.source).toEqual({ kind: 'websocket', url: 'ws://legacy-v1.example' });
  });

  it('rejects malformed current sources and dangling snapshot sources before opening a project', () => {
    const recording = createSingleSnapshot(emptyScenario(), { id: 'available-recording' });
    const archive = archiveProjectFileContent({
      version: PROJECT_FILE_VERSION,
      source: { kind: 'websocket', url: 'ws://valid.example' },
      mainView,
      scenario: emptyScenario(),
      snapshots: [recording],
    });

    expect(() => parseProjectFileContent({
      ...archive,
      source: { kind: 'websocket', url: 'http://invalid.example' },
    })).toThrow(/ws:\/\//);
    expect(() => parseProjectFileContent({
      ...archive,
      source: { kind: 'websocket', url: '' },
    })).toThrow(/ws:\/\//);
    expect(() => parseProjectFileContent({
      ...archive,
      source: { kind: 'snapshot', snapshot_id: 'missing-recording' },
    })).toThrow(/does not exist/);

    const recovered = recoverProjectFileContent({
      version: 1,
      url: 'not-a-websocket-url',
      mainView,
      scenario: emptyScenario(),
      snapshots: [recording],
    });
    expect(recovered?.content.source).toEqual({ kind: 'snapshot', snapshot_id: 'available-recording' });
    expect(recovered?.warnings).toContain('The first recovered snapshot was opened as the offline project source.');
  });

  it('serializes and deserializes snapshot recordings in MessagePack project files', async () => {
    let savedContent: ArrayBuffer | string | undefined;
    (getFileSystemState as any).mockReturnValue({
      writeFile: vi.fn().mockImplementation((_path: string, content: ArrayBuffer | string) => {
        savedContent = content;
        return Promise.resolve();
      }),
      readFile: vi.fn().mockImplementation(() => Promise.resolve({ content: savedContent })),
      createDirectory: vi.fn().mockResolvedValue(undefined),
    });

    mockedSettings.saveFormat = 'msgpack';
    useProjectStore.getState().new({ kind: 'websocket', url: 'ws://localhost:8080' });
    const snapshot = createSingleSnapshot(emptyScenario(), { id: 'recording-round-trip' });
    useProjectStore.getState().activeProject!.useScenarioStore.setState({ snapshots: [snapshot] });

    await useProjectStore.getState().save(0, 'recording.msgpack');
    expect(savedContent).toBeInstanceOf(ArrayBuffer);
    const decoded = decode(new Uint8Array(savedContent as ArrayBuffer)) as { snapshots: Array<{ metadata: Record<string, unknown> }> };
    expect(decoded.snapshots[0].metadata).not.toHaveProperty('label');

    await useProjectStore.getState().open('recording.msgpack', 1);
    expect(useProjectStore.getState().projects[1].useScenarioStore.getState().snapshots)
      .toMatchObject([{ metadata: { id: 'recording-round-trip' }, initial: { scenario: emptyScenario() } }]);
  });

  it('recovers a damaged recording from its initial state and reports warnings', async () => {
    const initialScenario = emptyScenario();
    (getFileSystemState as any).mockReturnValue({
      readFile: vi.fn().mockResolvedValue({ content: JSON.stringify({
        version: 1,
        url: 'http://recover.example',
        mainView,
        scenario: initialScenario,
        snapshots: [{
          version: 1,
          metadata: { id: 'damaged-recording', createdAt: 42 },
          initial: { frame: 0, timestamp: 42, scenario: initialScenario },
          keyframes: 'damaged',
          frames: [],
          layerCodecs: {},
          byteLength: 0,
          truncated: false,
        }],
      }) }),
    });

    const result = await useProjectStore.getState().open('/damaged-project.json');

    expect(result.recovered).toBe(true);
    expect(result.warnings).toContain('Snapshot 1 was recovered from its initial state; its timeline was discarded.');
    expect(useProjectStore.getState().projects[0].useScenarioStore.getState().snapshots)
      .toMatchObject([{ metadata: { id: 'damaged-recording' }, initial: { scenario: initialScenario }, frames: [] }]);
  });

  it('rejects unsupported project versions and malformed current project files before loading them', async () => {
    (getFileSystemState as any).mockReturnValue({
      readFile: vi.fn()
          .mockResolvedValueOnce({ content: JSON.stringify({ version: 4 }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ version: 1, url: 'http://broken.example' }) }),
    });

    await expect(useProjectStore.getState().open('/future.json'))
      .rejects.toThrow('Unsupported project file version: 4.');
    await expect(useProjectStore.getState().open('/malformed.json')).rejects.toThrow();
    expect(useProjectStore.getState().projects).toHaveLength(0);
  });

  it('should preserve trajectory data when saving and opening a project', async () => {
    let savedContent: any;
    (getFileSystemState as any).mockReturnValue({
      writeFile: vi.fn().mockImplementation((_path, content) => {
        savedContent = content;
        return Promise.resolve();
      }),
      readFile: vi.fn().mockImplementation(() => {
        return Promise.resolve({ content: savedContent });
      }),
      createDirectory: vi.fn().mockResolvedValue(undefined),
    });

    // 1. Create a project and add trajectory data
    const store = useProjectStore.getState();
    store.new({ kind: 'websocket', url: 'ws://localhost:8080' });

    const activeProject = useProjectStore.getState().activeProject!;
    const scenarioStore = activeProject.useScenarioStore.getState();
    const scenario = scenarioStore.scenario;

    // Manually setup environment and trajectory layer
    scenario.apply({ type: 'env_create', payload: { id: 'env1', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'env1', layer_id: 'agent-layer', layer_type: 'agent' } });
    scenario.apply({
      type: 'env_layer_create', payload: {
        env_id: 'env1',
        layer_id: 'trail-layer',
        layer_type: 'trajectory',
        dependency_layer_ids: { agent: 'agent-layer' }
      }
    });

    // Add some trajectory points
    scenario.apply({ type: 'item_create', payload: { env_id: 'env1', layer_id: 'agent-layer', items: [{ id: 'agent1', x: 0, y: 0 }] } });
    scenario.apply({ type: 'item_update', payload: { env_id: 'env1', layer_id: 'agent-layer', items: [{ id: 'agent1', x: 1, y: 1 }] } });

    // Verify trajectory has points
    const trajectoryStorage = scenario.getEnvironment('env1')!.layers.get('trail-layer')!.storage as any;
    expect(trajectoryStorage.dump().trajectories[0].points).toHaveLength(2);

    // 2. Save the project
    await useProjectStore.getState().save(0, 'my-project.json');

    // 3. Open the project
    await useProjectStore.getState().open('my-project.json', 1);

    const openedProject = useProjectStore.getState().projects[1];
    const openedScenario = openedProject.useScenarioStore.getState().scenario;
    const openedStorage = openedScenario.getEnvironment('env1')!.layers.get('trail-layer')!.storage as any;

    // Verify trajectory points are preserved
    const dumped = openedStorage.dump();
    expect(dumped.trajectories).toHaveLength(1);
    expect(dumped.trajectories[0].points).toHaveLength(2);
    expect(dumped.trajectories[0].points[0]).toMatchObject({ x: 0, y: 0 });
    expect(dumped.trajectories[0].points[1]).toMatchObject({ x: 1, y: 1 });
  });

  it('should preserve trajectory data with unbounded length (length=0)', async () => {
    let savedContent: any;
    (getFileSystemState as any).mockReturnValue({
      writeFile: vi.fn().mockImplementation((_path, content) => {
        savedContent = content;
        return Promise.resolve();
      }),
      readFile: vi.fn().mockImplementation(() => {
        return Promise.resolve({ content: savedContent });
      }),
      createDirectory: vi.fn().mockResolvedValue(undefined),
    });

    const store = useProjectStore.getState();
    store.new({ kind: 'websocket', url: 'ws://localhost:8080' });
    const scenario = useProjectStore.getState().activeProject!.useScenarioStore.getState().scenario;

    scenario.apply({ type: 'env_create', payload: { id: 'env1', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'env1', layer_id: 'agent-layer', layer_type: 'agent' } });
    scenario.apply({
      type: 'env_layer_create', payload: {
        env_id: 'env1',
        layer_id: 'trail-layer',
        layer_type: 'trajectory',
        dependency_layer_ids: { agent: 'agent-layer' },
        metadata: { length: 0 } // Unbounded
      }
    });

    scenario.apply({ type: 'item_create', payload: { env_id: 'env1', layer_id: 'agent-layer', items: [{ id: 'agent1', x: 0, y: 0 }] } });
    scenario.apply({ type: 'item_update', payload: { env_id: 'env1', layer_id: 'agent-layer', items: [{ id: 'agent1', x: 1, y: 1 }] } });

    const storage = scenario.getEnvironment('env1')!.layers.get('trail-layer')!.storage as any;
    expect(storage.getEntry('agent1').limit).toBe(0);
    expect(storage.dump().trajectories[0].points).toHaveLength(2);

    await useProjectStore.getState().save(0, 'my-project.json');
    await useProjectStore.getState().open('my-project.json', 1);

    const openedScenario = useProjectStore.getState().projects[1].useScenarioStore.getState().scenario;
    const openedStorage = openedScenario.getEnvironment('env1')!.layers.get('trail-layer')!.storage as any;

    const dumped = openedStorage.dump();
    expect(dumped.config.length).toBe(0);
    expect(dumped.trajectories).toHaveLength(1);
    expect(dumped.trajectories[0].points).toHaveLength(2);
  });

  it('stores identical live and recorded assets once in the project asset table', async () => {
    let savedContent = '';
    (getFileSystemState as any).mockReturnValue({
      writeFile: vi.fn().mockImplementation((_path: string, content: string) => {
        savedContent = content;
        return Promise.resolve();
      }),
    });
    const asset = {
      meta: { id: 'sprite', hash: 'same-bytes', mime: 'image/png', size: 3 },
      data: 'data:image/png;base64,AQID',
    };
    const scenario = { ...emptyScenario(), assets: [asset] };
    useProjectStore.getState().new({ kind: 'websocket', url: 'ws://assets.example' });
    const project = useProjectStore.getState().activeProject!;
    project.useScenarioStore.getState().load(scenario);
    project.useScenarioStore.setState({ snapshots: [createSingleSnapshot(scenario, { id: 'asset-recording' })] });

    await useProjectStore.getState().save(0, '/allowed/assets.json');

    const archive = JSON.parse(savedContent);
    expect(archive.assetTable).toEqual({ 'same-bytes': { mime: 'image/png', data: asset.data } });
    expect(archive.scenario.assets[0]).not.toHaveProperty('data');
    expect(archive.snapshots[0].segments[0].data).toEqual(expect.any(String));

    (getFileSystemState as any).mockReturnValue({
      readFile: vi.fn().mockResolvedValue({ content: savedContent }),
    });
    await useProjectStore.getState().open('/allowed/assets.json', 1);
    const opened = useProjectStore.getState().projects[1]!.useScenarioStore.getState();
    expect(opened.dump().assets[0]?.data).toBe(asset.data);
    expect(opened.snapshots[0]?.initial.scenario.assets[0]?.data).toBe(asset.data);
  });

  it('persists an offline snapshot as a first-class playback source', async () => {
    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    (getFileSystemState as any).mockReturnValue({ writeFile: mockWriteFile });
    const snapshot = createSingleSnapshot(emptyScenario(), { id: 'offline-source' });

    useProjectStore.getState().openOfflineSnapshot(snapshot);
    const project = useProjectStore.getState().activeProject!;
    expect(project.source).toEqual({ kind: 'snapshot', snapshot_id: 'offline-source' });
    expect(project.snapshotPlayback).toBeDefined();

    await useProjectStore.getState().save(0, '/offline-source.json');
    expect(JSON.parse(mockWriteFile.mock.calls[0][1]).source).toEqual({ kind: 'snapshot', snapshot_id: 'offline-source' });
  });

  it('protects the recording used by an active snapshot source', () => {
    const snapshot = createSingleSnapshot(emptyScenario(), { id: 'protected-source' });
    useProjectStore.getState().openOfflineSnapshot(snapshot);
    const project = useProjectStore.getState().activeProject!;

    expect(() => project.useScenarioStore.getState().removeSnapshot('protected-source'))
      .toThrow(/active project source/);
    expect(() => project.useScenarioStore.getState().clearSnapshots())
      .toThrow(/active project source/);
    expect(project.useScenarioStore.getState().snapshots).toHaveLength(1);
    expect(project.source).toEqual({ kind: 'snapshot', snapshot_id: 'protected-source' });
  });

  it('leaves a snapshot project unchanged when its replacement source is invalid', async () => {
    const snapshot = createSingleSnapshot(emptyScenario(), { id: 'stable-source' });
    useProjectStore.getState().openOfflineSnapshot(snapshot);
    const project = useProjectStore.getState().activeProject!;
    const originalPlayback = project.snapshotPlayback;

    await expect(useProjectStore.getState().changeSource(0, { kind: 'snapshot', snapshot_id: 'missing' }))
      .rejects.toThrow(/was not found/);

    expect(project.source).toEqual({ kind: 'snapshot', snapshot_id: 'stable-source' });
    expect(project.snapshotPlayback).toBe(originalPlayback);
    expect(project.useScenarioStore.getState().snapshots).toHaveLength(1);
  });

  it('rejects invalid source URLs before mutating the active project', async () => {
    useProjectStore.getState().new({ kind: 'websocket', url: 'ws://stable.example' });
    const project = useProjectStore.getState().activeProject!;

    await expect(useProjectStore.getState().changeSource(0, { kind: 'websocket', url: 'http://invalid.example' } as any))
      .rejects.toThrow(/ws:\/\//);

    expect(project.source).toEqual({ kind: 'websocket', url: 'ws://stable.example' });
  });
});
