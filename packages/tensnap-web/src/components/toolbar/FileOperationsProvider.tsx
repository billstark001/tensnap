import React, { createContext, useContext, useCallback, PropsWithChildren } from 'react';
import { FileMetadata } from '@/types/file';
import { useCallbackRef } from '@/utils/react';
import { useFileSystem } from '@/store/file-system/provider';

export interface FileOperationsContextValue {
  canSaveFile: boolean;
  onNewFile: () => void;
  onFileOpen: () => void;
  onFileSave: () => void;
  onFileSaveAs: () => void;
}

const FileOperationsContext = createContext<FileOperationsContextValue | null>(null);

export interface FileOperationsProviderProps extends PropsWithChildren {
  onNewFile?: () => void;
  onFileOpen?: (files: FileMetadata[]) => void;
  onFileSave?: (asPath?: string | null) => void;
  canSaveFile?: boolean;
}

export const FileOperationsProvider: React.FC<FileOperationsProviderProps> = ({
  children,
  canSaveFile = true,
  onNewFile: externalOnNewFile,
  onFileOpen: externalOnFileOpen,
  onFileSave: externalOnFileSave,
}) => {
  const filePicker = useFileSystem();

  const onFileOpen = useCallbackRef(externalOnFileOpen);
  const onFileSave = useCallbackRef(externalOnFileSave);
  const onNewFile = useCallbackRef(externalOnNewFile);

  const handleFileOpen = useCallback(async () => {
    try {
      const files = await filePicker.pickFiles();

      if (files.length > 0) {
        onFileOpen(files);
      }
    } catch (error) {
      console.error('Failed to open files:', error);
    }
  }, [filePicker, onFileOpen]);

  const handleSaveAs = useCallback(async () => {
    try {
      const files = await filePicker.pickFiles({
        title: '另存为',
        mode: 'save',
        multiSelect: false,
      });

      if (files.length > 0) {
        onFileSave(files[0].path);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [filePicker, onFileSave]);

  const handleFileSave = useCallback(
    () => onFileSave(),
    [onFileSave]
  );

  const contextValue: FileOperationsContextValue = {
    canSaveFile,
    onNewFile,
    onFileOpen: handleFileOpen,
    onFileSave: handleFileSave,
    onFileSaveAs: handleSaveAs,
  };
  

  return (
    <FileOperationsContext.Provider value={contextValue}>
      {children}


    </FileOperationsContext.Provider>
  );
};

export const useFileOperations = (): FileOperationsContextValue => {
  const context = useContext(FileOperationsContext);
  if (!context) {
    throw new Error('useFileOperations must be used within a FileOperationsProvider');
  }
  return context;
};
