import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileSystemBrowser } from './FileSystemBrowser';
import { FileMetadata, DirectoryMetadata, DirectoryEntry, FilePickerOptions, FileSystemAdapter, FileSystemPicker } from 'tensnap-web/types/file';
import * as dialogStyles from 'tensnap-web/styles/dialog.css';

export interface FilePickerResult {
  files: FileMetadata[];
  directories: DirectoryMetadata[];
  cancelled: boolean;
}

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
  resolve: ((result: FileMetadata[]) => void) | null;
}

export const FilePickerProvider: React.FC<FilePickerProviderProps> = ({ children, fileSystem }) => {
  const [pickerState, setPickerState] = useState<PickerState>({
    isOpen: false,
    options: {},
    resolve: null
  });

  const openPicker = useCallback((options: FilePickerOptions = {}): Promise<FileMetadata[]> => {
    return new Promise((resolve) => {
      setPickerState({
        isOpen: true,
        options,
        resolve
      });
    });
  }, []);

  const closePicker = useCallback((result: FileMetadata[]) => {
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
    closePicker([]);
  }, [closePicker]);

  const handleFileSelect = useCallback((file: DirectoryEntry) => {
    closePicker([file as FileMetadata]);
  }, [pickerState.options.mode, closePicker]);

  const pickFiles = useCallback((options?: FilePickerOptions): Promise<FileMetadata[]> => {
    return openPicker(options);
  }, [openPicker]);

  const contextValue: FilePickerContextValue = {
    pickFiles,
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
              <FileSystemBrowser
                fileSystem={fileSystem}
                onFileSelect={handleFileSelect}
                allowUpload={pickerState.options.allowUpload}
                multiSelect={pickerState.options.multiSelect}
              />
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

