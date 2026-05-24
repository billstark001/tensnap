
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectStore } from './project';
import { getFileSystemState } from './file-system/provider';

vi.mock('./file-system/provider', () => ({
  getFileSystemState: vi.fn(),
}));

vi.mock('./settings', () => ({
  useSettingsStore: {
    getState: () => ({
      saveFormat: 'json',
    }),
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
    store.new('http://localhost:8080');

    const activeProject = useProjectStore.getState().activeProject!;

    // Add a dummy snapshot
    const dummySnapshot = {
      metadata: { id: 'snapshot-1' },
      actions: [],
      parameters: [],
      environments: [],
      charts: [],
      logs: [],
    };

    activeProject.useScenarioStore.setState({
      snapshots: [dummySnapshot as any]
    });

    // Save the project
    await useProjectStore.getState().save(0, '/test/project.json');

    expect(mockWriteFile).toHaveBeenCalled();
    const savedContent = JSON.parse(mockWriteFile.mock.calls[0][1]);

    // This is expected to FAIL currently as snapshots are not included
    expect(savedContent).toHaveProperty('snapshots');
    expect(savedContent.snapshots).toHaveLength(1);
    expect(savedContent.snapshots[0].metadata.id).toBe('snapshot-1');
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
    store.new('http://localhost:8080');

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
    store.new('http://localhost:8080');
    const scenario = useProjectStore.getState().activeProject!.useScenarioStore.getState().scenario;

    scenario.apply({ type: 'env_create', payload: { id: 'env1', type: '2d' } });
    scenario.apply({ type: 'env_layer_create', payload: { env_id: 'env1', layer_id: 'agent-layer', layer_type: 'agent' } });
    scenario.apply({
      type: 'env_layer_create', payload: {
        env_id: 'env1',
        layer_id: 'trail-layer',
        layer_type: 'trajectory',
        dependency_layer_ids: { agent: 'agent-layer' },
        data: { length: 0 } // Unbounded
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
});
