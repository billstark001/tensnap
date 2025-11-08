import React, { createContext, useContext, useCallback, PropsWithChildren, useState } from 'react';
import { FileMetadata } from '@/types/file';
import { useFileSystem } from '@/store/file-system/provider';
import { CreateNewDialog } from '@/dialogs/CreateNewDialog';
import { useWithLoading } from '@/store/loading';
import { useProjectStore } from '@/store/project';

export interface FileOperationsContextValue {
  canSaveFile: boolean;
  onNewFile: () => void;
  onFileOpen: () => void;
  onFileSave: () => void;
  onFileSaveAs: () => void;
}

const FileOperationsContext = createContext<FileOperationsContextValue | null>(null);

export interface FileOperationsProviderProps extends PropsWithChildren {
}

export const FileOperationsProvider: React.FC<FileOperationsProviderProps> = ({
  children,
}) => {
  const filePicker = useFileSystem();

  const withLoading = useWithLoading();

  const {
    activeIndex,
    getDisplayNames,
    new: createNewProject,
    open,
    save,
  } = useProjectStore();

  // 管理标签页状态
  const tabs = getDisplayNames();
  const activeTabId = activeIndex != null ? tabs[activeIndex].id : undefined;
  const canSaveFile = activeTabId != null;


  const [isOpen, setOpen] = useState(false);

  const onNewFile = useCallback(() => {
    setOpen(true);
  }, []);

  const onCreateItem = useCallback((address: string) => {
    createNewProject(address);
    setOpen(false);
  }, [setOpen]);

  const onFileOpen = useCallback((files: FileMetadata[]) => {
    if (!files?.length) {
      return;
    }
    withLoading(() => open(files[0].path));
  }, [withLoading, open]);

  const onFileSave = useCallback((asPath?: string | null) => {
    withLoading(() => save(undefined, asPath ?? undefined));
  }, [withLoading, save]);

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
      <CreateNewDialog open={isOpen} onOpenChange={setOpen} onCreateItem={onCreateItem} />

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
