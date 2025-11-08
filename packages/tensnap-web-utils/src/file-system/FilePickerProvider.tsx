import React, { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import * as Dialog from 'tensnap-web/components/ui/Dialog';
import { FileSystemBrowser } from './FileSystemBrowser';
import { FileMetadata, DirectoryMetadata, DirectoryEntry, FilePickerOptions, FileSystemAdapter, FileSystemPicker } from 'tensnap-web/types/file';

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
      <Dialog.Root open={pickerState.isOpen} onOpenChange={(open) => !open && handleCancel()} size='xl'>
        <Dialog.Title>
          {pickerState.options.title}
        </Dialog.Title>
        <Dialog.Description></Dialog.Description>

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
        </Dialog.Footer>

        <Dialog.CloseButton />
      </Dialog.Root>
    </FilePickerContext.Provider>
  );
};

