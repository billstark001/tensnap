import { ComponentType, PropsWithChildren, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { FileMetadata, FilePickerOptions, FileSystemAdapter, FileSystemPicker } from '@tensnap/web-common/types/file';
import { FilePickerProvider, useFilePicker } from "./FilePickerProvider";

/**
 * 内部组件：用于从 FilePickerProvider 中提取 pickFiles 函数
 */
function InFilePickerTrigger(props: {
  onPickFilesChanged: (f: FileSystemPicker['pickFiles']) => void;
}) {
  const { pickFiles } = useFilePicker();
  
  useEffect(() => {
    props.onPickFilesChanged(pickFiles);
  }, [pickFiles, props]);
  
  return null;
}

/**
 * InBrowserFilePicker: 在浏览器环境中实现的文件选择器
 * 
 * 这个类创建一个隐藏的 React 根节点来渲染 FilePickerProvider，
 * 从而在非 React 应用或需要独立文件选择器的场景中使用。
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
    Wrapper?: ComponentType<PropsWithChildren<object>>
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
    
    // 创建 React 组件树
    const children = (
      <FilePickerProvider fileSystem={fileSystem}>
        <InFilePickerTrigger 
          onPickFilesChanged={(pickFiles) => {
            this._pickFiles = pickFiles;
          }} 
        />
      </FilePickerProvider>
    );
    
    const rootNode = Wrapper ? <Wrapper>{children}</Wrapper> : children;

    // 创建并渲染 React 根节点
    this.reactRootNode = ReactDOM.createRoot(rootElement);
    this.reactRootNode.render(rootNode);
    
    this.isInitialized = true;

    // 等待一个 tick 确保 React 组件已渲染
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
      throw new Error("File picker not initialized. Call initialize() first.");
    }
    return this._pickFiles(options);
  }
}