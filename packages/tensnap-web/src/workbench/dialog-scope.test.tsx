import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import { Providers } from '../Providers';
import { useProjectStore } from '../store/project';
import { useScenarioStore } from '../store/scenario/store';
import { initI18n } from '../i18n';
import { ConfirmDialog } from '@tensnap/web-common/components/ui/AlertDialog';
afterEach(() => {
  cleanup();
  for (const project of useProjectStore.getState().projects)
    project.useScenarioStore.getState().session.destroy();
  useProjectStore.setState({ projects: [], tabs: [], activeIndex: null, activeProject: null });
});

it('keeps original project services and callbacks across tab changes and closes when that project is removed', async () => {
  await initI18n('en');
  useProjectStore
    .getState()
    .openOfflineSnapshot(createSingleSnapshot(new Scenario().dump(), { id: 'a' }));
  const a = useProjectStore.getState().activeProject!;
  const committed: string[] = [];
  const Editor = defineDialog(
    'ScopeTest',
    ({
      open,
      onOpenChange,
      onCommit,
    }: {
      open: boolean;
      onOpenChange(open: boolean): void;
      onCommit(): void;
    }) => {
      const rename = useScenarioStore((store) => store.renameSnapshot);
      return (
        <Dialog.Root title="Scope editor" open={open} onOpenChange={onOpenChange}>
          <button
            onClick={() => {
              rename!('a', 'edited original');
              onCommit();
            }}
          >
            Commit
          </button>
        </Dialog.Root>
      );
    },
  );
  function Caller() {
    const project = useProjectStore((store) => store.activeProject)!;
    const [open, setOpen] = useState(true);
    return (
      <Editor open={open} onOpenChange={setOpen} onCommit={() => committed.push(project.id)} />
    );
  }
  render(
    <Providers>
      <Caller />
    </Providers>,
  );
  act(() =>
    useProjectStore
      .getState()
      .openOfflineSnapshot(createSingleSnapshot(new Scenario().dump(), { id: 'b' })),
  );
  const b = useProjectStore.getState().activeProject!;
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
  expect(committed).toEqual([a.id]);
  expect(a.useScenarioStore.getState().snapshots[0].metadata.label).toBe('edited original');
  expect(b.useScenarioStore.getState().snapshots[0].metadata.label).not.toBe('edited original');
  act(() => useProjectStore.setState({ projects: [b] }));
  expect(screen.queryByRole('dialog', { name: 'Scope editor' })).toBeNull();
  a.useScenarioStore.getState().session.destroy();
});
it('executes real confirmation clicks locally and replaces callbacks without any data prop change', async () => {
  await initI18n('en');
  const first = vi.fn(),
    next = vi.fn();
  const props = { open: true, title: 'Discard?', description: 'Unsaved', onOpenChange: vi.fn() };
  const view = render(
    <Providers>
      <ConfirmDialog {...props} onConfirm={first} />
    </Providers>,
  );
  view.rerender(
    <Providers>
      <ConfirmDialog {...props} onConfirm={next} />
    </Providers>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(first).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledTimes(1);
});
