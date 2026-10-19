import { beforeEach, expect, it } from 'vitest';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import {
  encodeRecordingFile,
  encodeProjectFile,
  createDefaultRootLayout,
} from '@tensnap/core/persistence';
import { importDroppedFiles } from './file-drop';
import { useProjectStore } from '../store/project';

const snapshot = (id: string) => createSingleSnapshot(new Scenario().dump(), { id });
const file = (id: string, format: 'json' | 'msgpack' = 'msgpack') => ({
  name: `${id}.${format}`,
  read: async () => encodeRecordingFile(snapshot(id), { format }),
});
beforeEach(() =>
  useProjectStore.setState({
    projects: [],
    tabs: [],
    activeIndex: null,
    activeProject: null,
    activeFilepath: null,
  }),
);
it('opens dropped JSON and MessagePack recordings in separate offline tabs', async () => {
  expect(await importDroppedFiles([file('a', 'json'), file('b')], { kind: 'workbench' })).toEqual(
    [],
  );
  expect(useProjectStore.getState().projects.map((p) => p.source)).toEqual([
    { kind: 'snapshot', snapshot_id: 'a' },
    { kind: 'snapshot', snapshot_id: 'b' },
  ]);
});
it('creates one offline tab for a batch dropped on an empty snapshots panel', async () => {
  expect(
    await importDroppedFiles([file('a'), file('b')], { kind: 'snapshots', projectId: null }),
  ).toEqual([]);
  const projects = useProjectStore.getState().projects;
  expect(projects).toHaveLength(1);
  expect(projects[0].useScenarioStore.getState().snapshots.map((s) => s.metadata.id)).toEqual([
    'a',
    'b',
  ]);
});
it('keeps the captured destination when another tab becomes active while reading', async () => {
  const store = useProjectStore.getState();
  store.openOfflineSnapshot(snapshot('a'));
  const destination = useProjectStore.getState().activeProject!;
  let finish!: (bytes: Uint8Array) => void;
  const pending = importDroppedFiles(
    [
      {
        name: 'late',
        read: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    ],
    { kind: 'snapshots', projectId: destination.id },
  );
  store.openOfflineSnapshot(snapshot('b'));
  finish(encodeRecordingFile(snapshot('late')));
  expect(await pending).toEqual([]);
  expect(destination.useScenarioStore.getState().snapshots.map((s) => s.metadata.id)).toEqual([
    'a',
    'late',
  ]);
  expect(
    useProjectStore
      .getState()
      .activeProject!.useScenarioStore.getState()
      .snapshots.map((s) => s.metadata.id),
  ).toEqual(['b']);
  await destination.useUndoRedoStore.getState().undo();
  expect(destination.useScenarioStore.getState().snapshots.map((s) => s.metadata.id)).toEqual([
    'a',
  ]);
});
it('extracts recordings from an enclosing project without opening its source', async () => {
  const bytes = encodeProjectFile(
    {
      version: 3,
      source: { kind: 'websocket', url: 'ws://localhost:9' },
      scenario: new Scenario().dump(),
      mainView: createDefaultRootLayout(),
      snapshots: [snapshot('a'), snapshot('b')],
    },
    'msgpack',
  );
  expect(
    await importDroppedFiles([{ name: 'project', read: async () => bytes }], {
      kind: 'snapshots',
      projectId: null,
    }),
  ).toEqual([]);
  expect(useProjectStore.getState().projects).toHaveLength(1);
  expect(useProjectStore.getState().activeProject!.source.kind).toBe('snapshot');
});
it('reports duplicates and corrupt files without losing existing recordings', async () => {
  useProjectStore.getState().openOfflineSnapshot(snapshot('a'));
  const project = useProjectStore.getState().activeProject!;
  const errors = await importDroppedFiles(
    [file('a'), { name: 'bad', read: async () => Uint8Array.of(0xc1) }, file('b')],
    { kind: 'snapshots', projectId: project.id },
  );
  expect(errors).toHaveLength(2);
  expect(project.useScenarioStore.getState().snapshots.map((s) => s.metadata.id)).toEqual([
    'a',
    'b',
  ]);
});
