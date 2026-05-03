import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilePickerProvider } from './FilePickerProvider';
import { useFilePicker } from './FilePickerContext';
import { DirectoryMetadata, FileSystemAdapter, FileMetadata } from '@tensnap/web-common/types/file';

vi.mock('./FileSystemBrowser.css', () => ({
  selectionBar: 'selectionBar',
  selectionBarLabel: 'selectionBarLabel',
  selectionBarInput: 'selectionBarInput',
  selectionBarButtons: 'selectionBarButtons',
}));

vi.mock('@lingui/macro', () => ({
  t: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (result, segment, index) => result + segment + (values[index] ?? ''),
    ''
  ),
}));

vi.mock('@tensnap/web-common/components/ui', () => ({
  Dialog: {
    Root: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
    Title: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Description: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Body: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Footer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
    Close: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    CloseButton: () => null,
  },
}));

vi.mock('./FileSystemBrowser', () => ({
  FileSystemBrowser: ({ onCurrentDirectoryChange }: { onCurrentDirectoryChange?: (path: string) => void }) => (
    <button onClick={() => onCurrentDirectoryChange?.('/projects/demo')}>change-directory</button>
  ),
}));

class StubFileSystemAdapter extends FileSystemAdapter {
  async initialize(): Promise<void> {}
  async cleanup(): Promise<void> {}
  async writeFile(): Promise<never> { throw new Error('not implemented'); }
  async readFile(): Promise<null> { return null; }
  async deleteFile(): Promise<void> {}
  async createDirectory(): Promise<DirectoryMetadata> { throw new Error('not implemented'); }
  async deleteDirectory(): Promise<void> {}
  async list(): Promise<[]> { return []; }
  async getStats() {
    return { totalFiles: 0, totalDirectories: 0, totalSize: 0 };
  }
  async fileExists(): Promise<boolean> { return false; }
  async directoryExists(): Promise<boolean> { return true; }
}

function Trigger({ onResult }: { onResult: (result: FileMetadata[]) => void }) {
  const { pickFiles } = useFilePicker();

  return (
    <button
      onClick={async () => {
        const result = await pickFiles({ mode: 'save' });
        onResult(result);
      }}
    >
      open-picker
    </button>
  );
}

describe('FilePickerProvider', () => {
  it('returns the full save path for the current directory', async () => {
    const onResult = vi.fn();

    render(
      <FilePickerProvider fileSystem={new StubFileSystemAdapter()}>
        <Trigger onResult={onResult} />
      </FilePickerProvider>
    );

    fireEvent.click(screen.getByText('open-picker'));
    fireEvent.click(screen.getByText('change-directory'));
    fireEvent.change(screen.getByPlaceholderText('Enter file name'), {
      target: { value: 'model.json' },
    });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith([
        expect.objectContaining({
          path: '/projects/demo/model.json',
          name: 'model.json',
          parentPath: '/projects/demo',
        }),
      ]);
    });
  });
});