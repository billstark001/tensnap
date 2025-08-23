import React, { createContext, useContext, useCallback, PropsWithChildren, useState } from 'react';
import { FileMetadata } from '@/types/file';
import { ExportDialog, useFilePicker } from '../file-system';
import { useCallbackRef } from '@/utils/react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileSystemBrowser } from '../file-system/FileSystemBrowser';
import { UseFileSystemGuard } from '../../store/file-system/provider';
import * as dialogStyles from '../../styles/dialog.css';

export interface FileOperationsContextValue {
  canSaveFile: boolean;
  onNewFile: () => void;
  onFileOpen: () => void;
  onDirectoryOpen: () => void;
  onFileSave: () => void;
  onFileSaveAs: () => void;
  onExport: () => void;
  onOpenBrowser: () => void;
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
  const filePicker = useFilePicker();

  const onFileOpen = useCallbackRef(externalOnFileOpen);
  const onFileSave = useCallbackRef(externalOnFileSave);
  const onNewFile = useCallbackRef(externalOnNewFile);

  const handleFileOpen = useCallback(async () => {
    try {
      const files = await filePicker.pickFiles({
        title: '选择文件',
        multiSelect: true,
        mode: 'files'
      });

      if (!files.cancelled && files.files.length > 0) {
        onFileOpen(files.files);
      }
    } catch (error) {
      console.error('Failed to open files:', error);
    }
  }, [filePicker, onFileOpen]);

  const handleDirectoryOpen = useCallback(async () => {
    try {
      const result = await filePicker.pickFiles({
        title: '选择文件夹',
        mode: 'directories'
      });

      if (!result.cancelled && result.directories.length > 0) {
        console.log('Selected directories:', result.directories);
        // 这里可以处理目录选择
      }
    } catch (error) {
      console.error('Failed to open directory:', error);
    }
  }, [filePicker]);

  const handleSaveAs = useCallback(async () => {
    try {
      const file = await filePicker.pickFile({
        title: '另存为',
        mode: 'files'
      });

      if (file) {
        onFileSave(file.path);
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [filePicker, onFileSave]);

  // dialogs
  const [exportOpen, setExportOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);

  const onExport = useCallback(() => {
    setExportOpen(true);
  }, []);

  const onOpenBrowser = useCallback(() => {
    setBrowserOpen(true);
  }, []);

  const handleFileSave = useCallback(
    () => onFileSave(),
    [onFileSave]
  );

  const contextValue: FileOperationsContextValue = {
    canSaveFile,
    onNewFile,
    onFileOpen: handleFileOpen,
    onDirectoryOpen: handleDirectoryOpen,
    onFileSave: handleFileSave,
    onFileSaveAs: handleSaveAs,
    onExport,
    onOpenBrowser,
  };

  return (
    <FileOperationsContext.Provider value={contextValue}>
      {children}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        customOptions={[
          {
            key: 'custom',
            title: '自定义导出',
            description: '自定义格式导出',
            format: 'other',
            handler: () => {
              onExport?.();
            }
          }
        ]}
        showDefaultOptions={true}
      />

      <Dialog.Root open={browserOpen} onOpenChange={setBrowserOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogStyles.dialogOverlay} />
          <Dialog.Content className={dialogStyles.dialogContentXLarge}>
            <div className={dialogStyles.dialogHeader}>
              <Dialog.Title className={dialogStyles.dialogTitle}>
                文件浏览器
              </Dialog.Title>
              <Dialog.Description></Dialog.Description>
            </div>

            <div className={dialogStyles.dialogBody}>
              <UseFileSystemGuard>
                <FileSystemBrowser
                  onFileSelect={(file) => {
                    console.log('Selected file:', file);
                    // TODO add file management
                    // TODO merge this one with FilePickerProvider
                    setBrowserOpen(false);
                  }}
                  onDirectorySelect={(directory) => {
                    console.log('Selected directory:', directory);
                  }}
                  allowUpload={true}
                  multiSelect={false}
                />
              </UseFileSystemGuard>
            </div>

            <Dialog.Close asChild>
              <button
                className={dialogStyles.dialogClose}
                aria-label="关闭"
              >
                ✕
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      
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
