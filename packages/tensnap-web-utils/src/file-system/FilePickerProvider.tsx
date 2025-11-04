import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileSystemBrowser } from './FileSystemBrowser';
import { FileMetadata, DirectoryMetadata, DirectoryEntry } from 'tensnap-web/types/file';
import { UseFileSystemGuard } from 'tensnap-web/store/file-system/provider';
import * as dialogStyles from 'tensnap-web/styles/dialog.css';

export interface FilePickerOptions {
  title?: string;
  multiSelect?: boolean;
  mode?: 'files' | 'directories' | 'both';
  allowUpload?: boolean;
}

export interface FilePickerResult {
  files: FileMetadata[];
  directories: DirectoryMetadata[];
  cancelled: boolean;
}

interface FilePickerContextValue {
  pickFiles: (options?: FilePickerOptions) => Promise<FilePickerResult>;
  pickFile: (options?: Omit<FilePickerOptions, 'multiSelect'>) => Promise<FileMetadata | null>;
  pickDirectory: (options?: Omit<FilePickerOptions, 'multiSelect' | 'mode'>) => Promise<DirectoryMetadata | null>;
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
}

interface PickerState {
  isOpen: boolean;
  options: FilePickerOptions;
  resolve: ((result: FilePickerResult) => void) | null;
}

export const FilePickerProvider: React.FC<FilePickerProviderProps> = ({ children }) => {
  const [pickerState, setPickerState] = useState<PickerState>({
    isOpen: false,
    options: {},
    resolve: null
  });

  const openPicker = useCallback((options: FilePickerOptions = {}): Promise<FilePickerResult> => {
    return new Promise((resolve) => {
      setPickerState({
        isOpen: true,
        options: {
          title: '选择文件',
          multiSelect: false,
          mode: 'files',
          allowUpload: true,
          ...options
        },
        resolve
      });
    });
  }, []);

  const closePicker = useCallback((result: FilePickerResult) => {
    if (pickerState.resolve) {
      pickerState.resolve(result);
    }
    setPickerState({
      isOpen: false,
      options: {},
      resolve: null
    });
  }, [pickerState.resolve]);

  const handleCancel = useCallback(() => {
    closePicker({
      files: [],
      directories: [],
      cancelled: true
    });
  }, [closePicker]);

  const handleFileSelect = useCallback((file: DirectoryEntry) => {
    if (pickerState.options.mode === 'directories') return;

    closePicker({
      files: [file as FileMetadata],
      directories: [],
      cancelled: false
    });
  }, [pickerState.options.mode, closePicker]);

  const handleDirectorySelect = useCallback((directory: DirectoryMetadata) => {
    if (pickerState.options.mode === 'files') return;

    closePicker({
      files: [],
      directories: [directory],
      cancelled: false
    });
  }, [pickerState.options.mode, closePicker]);

  const pickFiles = useCallback((options?: FilePickerOptions): Promise<FilePickerResult> => {
    return openPicker({
      mode: 'files',
      multiSelect: true,
      ...options
    });
  }, [openPicker]);

  const pickFile = useCallback(async (options?: Omit<FilePickerOptions, 'multiSelect'>): Promise<FileMetadata | null> => {
    const result = await openPicker({
      mode: 'files',
      multiSelect: false,
      ...options
    });
    return result.cancelled ? null : result.files[0] || null;
  }, [openPicker]);

  const pickDirectory = useCallback(async (options?: Omit<FilePickerOptions, 'multiSelect' | 'mode'>): Promise<DirectoryMetadata | null> => {
    const result = await openPicker({
      mode: 'directories',
      multiSelect: false,
      ...options
    });
    return result.cancelled ? null : result.directories[0] || null;
  }, [openPicker]);

  const contextValue: FilePickerContextValue = {
    pickFiles,
    pickFile,
    pickDirectory
  };

  return (
    <FilePickerContext.Provider value={contextValue}>
      {children}

      {/* 文件选择器对话框 */}
      <Dialog.Root open={pickerState.isOpen} onOpenChange={(open) => !open && handleCancel()}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogStyles.dialogOverlay} />
          <Dialog.Content className={dialogStyles.dialogContentXLarge}>
            <div className={dialogStyles.dialogHeader}>
              <Dialog.Title className={dialogStyles.dialogTitle}>
                {pickerState.options.title}
              </Dialog.Title>
              <Dialog.Description></Dialog.Description>
            </div>

            <div className={dialogStyles.dialogBody}>
              <UseFileSystemGuard>
                <FileSystemBrowser
                  onFileSelect={handleFileSelect}
                  onDirectorySelect={handleDirectorySelect}
                  allowUpload={pickerState.options.allowUpload}
                  multiSelect={pickerState.options.multiSelect}
                />
              </UseFileSystemGuard>
            </div>

            <div className={dialogStyles.dialogFooter}>
              <Dialog.Close asChild>
                <button className={dialogStyles.dialogButton} onClick={handleCancel}>
                  取消
                </button>
              </Dialog.Close>
            </div>

            <Dialog.Close asChild>
              <button
                className={dialogStyles.dialogClose}
                aria-label="关闭"
                onClick={handleCancel}
              >
                ✕
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </FilePickerContext.Provider>
  );
};
