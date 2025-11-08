import { ComponentType, PropsWithChildren, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { FileMetadata, FilePickerOptions, FileSystemAdapter, FileSystemPicker } from "tensnap-web/types/file";
import { FilePickerContextValue, FilePickerProvider, useFilePicker } from "./FilePickerProvider";


function InFilePickerTrigger(props: {
  onPickFilesChanged: (f: FileSystemPicker['pickFiles']) => void;
}) {
  const { pickFiles } = useFilePicker();
  useEffect(() => {
    props.onPickFilesChanged(pickFiles);
  }, [pickFiles]);
  return <></>;
}

export class InBrowserFilePicker extends FileSystemPicker {

  private rootElement: HTMLElement;
  private fileSystem: FileSystemAdapter;
  private Wrapper?: ComponentType<PropsWithChildren<object>>;
  private _pickFiles?: FileSystemPicker['pickFiles'];

  private reactRootNode?: ReactDOM.Root;
  
  constructor(rootElement: HTMLElement, fileSystem: FileSystemAdapter, Wrapper?: ComponentType<PropsWithChildren<object>>) {
    super();
    this.rootElement = rootElement;
    this.fileSystem = fileSystem;
    this.Wrapper = Wrapper;
  }


  initialize(): Promise<void> {
    const { rootElement, fileSystem, Wrapper } = this;
    const children = <FilePickerProvider fileSystem={fileSystem}>
      <InFilePickerTrigger onPickFilesChanged={(pickFiles) => {
        this._pickFiles = pickFiles;
      }} />
    </FilePickerProvider>;
    const rootNode = Wrapper
      ? <Wrapper>{children}</Wrapper>
      : children;

    const reactRootNode = ReactDOM.createRoot(rootElement)
    reactRootNode.render(rootNode);
    this.reactRootNode = reactRootNode;
    return Promise.resolve();
  }
  cleanup(): Promise<void> {
    if (this.reactRootNode) {
      this.reactRootNode.unmount();
    }
    return Promise.resolve();
  }
  pickFiles(options?: FilePickerOptions): Promise<FileMetadata[]> {
    if (!this._pickFiles) {
      throw new Error("File picker not initialized");
    }
    return this._pickFiles(options);
  }
  
}