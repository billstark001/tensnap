import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { FileSystemBrowser } from '../../../web-adapter/src/file-system/FileSystemBrowser';
import { MemoryFileSystemAdapter } from '../../../web-adapter/src/adapters/memory-adapter';
import { FilePickerProvider } from '../../../web-adapter/src/file-system/FilePickerProvider';
import { useFilePicker } from '../../../web-adapter/src/file-system/FilePickerContext';

beforeEach(() => {
  i18n.loadAndActivate({ locale: 'en', messages: {} });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const fileSystem = new MemoryFileSystemAdapter();
  await fileSystem.initialize();
  await fileSystem.writeFile('/example.bin', new Uint8Array([0, 255, 1]).buffer, {
    mimeType: 'application/x-test',
  });
  await fileSystem.createDirectory('/destination');
  const onFileSelect = vi.fn();
  render(<FileSystemBrowser fileSystem={fileSystem} onFileSelect={onFileSelect} />);
  const name = await screen.findByText('example.bin');
  return { fileSystem, onFileSelect, row: name.closest('[tabindex]')! };
}

it('opens the same file actions from the ellipsis, right-click and keyboard without selecting the file', async () => {
  const { row, onFileSelect } = await fixture();
  fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Action menu' }));
  expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'Download this file',
    'Move',
    'Rename',
    'Delete',
  ]);
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.contextMenu(row, { clientX: 200, clientY: 150 });
  expect(screen.getByRole('menu').closest('[data-workbench-menu]')).toHaveStyle({
    left: '200px',
    top: '150px',
  });
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  fireEvent.keyDown(row, { key: 'F10', shiftKey: true });
  expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
  expect(onFileSelect).not.toHaveBeenCalled();
});

it('renames and moves files through dialogs, refreshes the listing and retains data', async () => {
  const { fileSystem, row } = await fixture();
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const rename = await screen.findByRole('dialog', { name: 'Rename' });
  fireEvent.change(within(rename).getByLabelText('Name'), { target: { value: 'renamed.bin' } });
  fireEvent.click(within(rename).getByRole('button', { name: 'Rename' }));
  const renamed = await screen.findByText('renamed.bin');
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename' })).toBeNull());
  fireEvent.contextMenu(renamed.closest('[tabindex]')!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move' }));
  const move = await screen.findByRole('dialog', { name: 'Move' });
  fireEvent.click(await within(move).findByRole('button', { name: '📁 destination' }));
  await waitFor(() => expect(within(move).getByRole('button', { name: 'Move' })).toBeEnabled());
  fireEvent.click(within(move).getByRole('button', { name: 'Move' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move' })).toBeNull());
  expect(screen.queryByText('renamed.bin')).toBeNull();
  expect(
    Array.from(
      new Uint8Array(
        (await fileSystem.readFile('/destination/renamed.bin'))!.content as ArrayBuffer,
      ),
    ),
  ).toEqual([0, 255, 1]);
  expect(await fileSystem.readFile('/example.bin')).toBeNull();
});

it('reports name collisions in place and downloads the original binary content and filename', async () => {
  const { fileSystem, row } = await fixture();
  await fileSystem.writeFile('/occupied.bin', 'keep');
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const dialog = await screen.findByRole('dialog', { name: 'Rename' });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'occupied.bin' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Destination already exists');
  expect((await fileSystem.readFile('/occupied.bin'))?.content).toBe('keep');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:test-download');
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  let link: { download: string; href: string } | undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    link = { download: this.download, href: this.href };
  });
  fireEvent.contextMenu(row);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download this file' }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
  expect(link?.download).toBe('example.bin');
  expect(link?.href).toBe('blob:test-download');
  expect(create.mock.calls[0]?.[0]).toMatchObject({ type: 'application/x-test', size: 3 });
});

it('clears stale picker selection after renaming a selected file', async () => {
  const fileSystem = new MemoryFileSystemAdapter();
  await fileSystem.initialize();
  await fileSystem.writeFile('/selected.txt', 'original bytes');
  const result = vi.fn();
  function Trigger() {
    const { pickFiles } = useFilePicker();
    return (
      <button onClick={() => void pickFiles({ mode: 'open' }).then(result)}>Choose file</button>
    );
  }
  render(
    <FilePickerProvider fileSystem={fileSystem}>
      <Trigger />
    </FilePickerProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  const name = await screen.findByText('selected.txt');
  fireEvent.click(name);
  expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
  fireEvent.contextMenu(name.closest('[tabindex]')!);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const dialog = await screen.findByRole('dialog', { name: 'Rename' });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'updated.txt' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
  fireEvent.click(await screen.findByText('updated.txt'));
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() =>
    expect(result).toHaveBeenCalledWith([expect.objectContaining({ path: '/updated.txt' })]),
  );
});
