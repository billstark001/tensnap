import React, { createContext, useContext, useCallback, useState, useRef, ReactNode } from 'react';
import * as Dialog from 'tensnap-web/components/ui/Dialog';
import { FileSystemBrowser } from './FileSystemBrowser';
import { FileMetadata, DirectoryEntry, FilePickerOptions, FileSystemAdapter, FileSystemPicker } from 'tensnap-web/types/file';

export interface FilePickerContextValue {
  pickFiles: FileSystemPicker['pickFiles'];
}

const FilePickerContext = createContext<FilePickerContextValue | null>(null);

export const useFilePicker = (): FilePickerContextValue => {
  const context = useContext(FilePickerContext);
  if (!context) {
    throw new Error('useFilePicker must be used within a FilePickerProvider');
  }
  return context;
};

interface FilePickerProviderProps {
  children: ReactNode;
  fileSystem: FileSystemAdapter;
}

interface PickerState {
  isOpen: boolean;
  options: FilePickerOptions;
}

export const FilePickerProvider: React.FC<FilePickerProviderProps> = ({ children, fileSystem }) => {
  const [pickerState, setPickerState] = useState<PickerState>({
    isOpen: false,
    options: {}
  });

  const [selectedItems, setSelectedItems] = useState<DirectoryEntry[]>([]);
  const resolveRef = useRef<((result: FileMetadata[]) => void) | null>(null);

  const openPicker = useCallback((options: FilePickerOptions = {}): Promise<FileMetadata[]> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setSelectedItems([]);
      setPickerState({
        isOpen: true,
        options
      });
    });
  }, []);

  const closePicker = useCallback((result: FileMetadata[]) => {
    if (resolveRef.current) {
      resolveRef.current(result);
      resolveRef.current = null;
    }
    setPickerState({
      isOpen: false,
      options: {}
    });
    setSelectedItems([]);
  }, []);

  const handleCancel = useCallback(() => {
    closePicker([]);
  }, [closePicker]);

  const handleFileSelect = useCallback((entry: DirectoryEntry) => {
    const { mode, multiSelect } = pickerState.options;

    // 如果是保存模式，不允许选择现有文件
    if (mode === 'save') {
      return;
    }

    // 只允许选择文件，不允许选择目录
    if (entry.type === 'directory') {
      return;
    }

    if (multiSelect) {
      // 多选模式：切换选择状态
      setSelectedItems(prev => {
        const exists = prev.find(item => item.path === entry.path);
        if (exists) {
          return prev.filter(item => item.path !== entry.path);
        } else {
          return [...prev, entry];
        }
      });
    } else {
      // 单选模式：直接选择并关闭
      closePicker([entry as FileMetadata]);
    }
  }, [pickerState.options, closePicker]);

  const handleConfirm = useCallback(() => {
    // 多选模式下的确认
    if (pickerState.options.multiSelect) {
      closePicker(selectedItems as FileMetadata[]);
    }
  }, [pickerState.options.multiSelect, selectedItems, closePicker]);

  const pickFiles = useCallback((options?: FilePickerOptions): Promise<FileMetadata[]> => {
    return openPicker(options);
  }, [openPicker]);

  const contextValue: FilePickerContextValue = {
    pickFiles,
  };

  const dialogTitle = pickerState.options.title || 
    (pickerState.options.mode === 'save' ? '保存文件' : 
     pickerState.options.multiSelect ? '选择文件' : '打开文件');

  const showConfirmButton = pickerState.options.multiSelect && selectedItems.length > 0;

  return (
    <FilePickerContext.Provider value={contextValue}>
      {children}

      {/* 文件选择器对话框 */}
      <Dialog.Root open={pickerState.isOpen} onOpenChange={(open) => !open && handleCancel()} size='full'>
        <Dialog.Title>
          {dialogTitle}
        </Dialog.Title>
        <Dialog.Description>
          {pickerState.options.multiSelect && `已选择 ${selectedItems.length} 个文件`}
        </Dialog.Description>

        <Dialog.Body>
          <FileSystemBrowser
            fileSystem={fileSystem}
            onFileSelect={handleFileSelect}
            allowUpload={pickerState.options.allowUpload}
            multiSelect={pickerState.options.multiSelect}
          />
        </Dialog.Body>

        <Dialog.Footer>
          <Dialog.Close asChild>
            <Dialog.Button onClick={handleCancel}>
              取消
            </Dialog.Button>
          </Dialog.Close>
          {showConfirmButton && (
            <Dialog.Button variant="primary" onClick={handleConfirm}>
              确认选择 ({selectedItems.length})
            </Dialog.Button>
          )}
        </Dialog.Footer>

        <Dialog.CloseButton />
      </Dialog.Root>
    </FilePickerContext.Provider>
  );
};

