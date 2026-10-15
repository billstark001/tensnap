import { ComponentType, PropsWithChildren } from 'react';
import ReactDOM from 'react-dom/client';
import {
  FileMetadata,
  FilePickerOptions,
  FileSystemAdapter,
  FileSystemPicker,
} from '@tensnap/web-common/types/file';
import { FilePickerProvider } from './FilePickerProvider';
import { FilePickerBridge } from './FilePickerBridge';

/**
 * Browser file picker with an independently mounted React root.
 *
 * Mounts FilePickerProvider into the supplied root element so callers can use
 * the picker outside an existing React application.
 */
export class InBrowserFilePicker extends FileSystemPicker {
  private rootElement: HTMLElement;
  private fileSystem: FileSystemAdapter;
  private Wrapper?: ComponentType<PropsWithChildren<object>>;
  private _pickFiles?: FileSystemPicker['pickFiles'];
  private reactRootNode?: ReactDOM.Root;
  private isInitialized = false;

  constructor(
    rootElement: HTMLElement,
    fileSystem: FileSystemAdapter,
    Wrapper?: ComponentType<PropsWithChildren<object>>,
  ) {
    super();
    this.rootElement = rootElement;
    this.fileSystem = fileSystem;
    this.Wrapper = Wrapper;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('InBrowserFilePicker is already initialized');
      return;
    }

    const { rootElement, fileSystem, Wrapper } = this;

    const children = (
      <FilePickerProvider fileSystem={fileSystem}>
        <FilePickerBridge
          onPickFilesChanged={(pickFiles) => {
            this._pickFiles = pickFiles;
          }}
        />
      </FilePickerProvider>
    );

    const rootNode = Wrapper ? <Wrapper>{children}</Wrapper> : children;

    this.reactRootNode = ReactDOM.createRoot(rootElement);
    this.reactRootNode.render(rootNode);

    this.isInitialized = true;

    await Promise.resolve();
  }

  async cleanup(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    if (this.reactRootNode) {
      this.reactRootNode.unmount();
      this.reactRootNode = undefined;
    }

    this._pickFiles = undefined;
    this.isInitialized = false;
  }

  pickFiles(options?: FilePickerOptions): Promise<FileMetadata[]> {
    if (!this.isInitialized || !this._pickFiles) {
      throw new Error('File picker not initialized. Call initialize() first.');
    }
    return this._pickFiles(options);
  }
}
