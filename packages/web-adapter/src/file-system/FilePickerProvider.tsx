import React, { useCallback, useState, useRef, ReactNode } from 'react';
import { Dialog } from '@tensnap/web-common/components/ui';
import { t } from '@lingui/macro';
import { FileSystemBrowser } from './FileSystemBrowser';
import { FileMetadata, DirectoryEntry, FilePickerOptions, FileSystemAdapter } from '@tensnap/web-common/types/file';
import { FilePickerContext, FilePickerContextValue } from './FilePickerContext';
import { joinPath, validateName } from './utils';
import * as styles from './FileSystemBrowser.css';

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
  const [inputFileName, setInputFileName] = useState<string>('');
  const [currentDirectory, setCurrentDirectory] = useState<string>('/');
  const [browserKey, setBrowserKey] = useState(0);
  const resolveRef = useRef<((result: FileMetadata[]) => void) | null>(null);

  const openPicker = useCallback((options: FilePickerOptions = {}): Promise<FileMetadata[]> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setSelectedItems([]);
      setInputFileName('');
      setCurrentDirectory('/');
      setBrowserKey((prev) => prev + 1);
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
    setInputFileName('');
    setCurrentDirectory('/');
  }, []);

  const handleCancel = useCallback(() => {
    closePicker([]);
  }, [closePicker]);

  const handleFileSelect = useCallback((entry: DirectoryEntry) => {
    const { multiSelect } = pickerState.options;

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
      // 单选模式：只更新选择状态，不关闭对话框
      setSelectedItems([entry]);
      // 更新输入框文件名
      setInputFileName(entry.name);
    }
  }, [pickerState.options]);

  const handleFileDoubleClick = useCallback((entry: DirectoryEntry) => {
    // 双击文件时直接确认并关闭
    if (entry.type === 'file') {
      closePicker([entry as FileMetadata]);
    }
  }, [closePicker]);

  const handleConfirm = useCallback(() => {
    const { mode, multiSelect } = pickerState.options;
    const fileName = inputFileName.trim();

    if (multiSelect) {
      // 多选模式下的确认
      closePicker(selectedItems as FileMetadata[]);
    } else if (mode === 'save') {
      // 保存模式：使用输入的文件名
      const validation = validateName(fileName);
      if (!validation.valid) {
        return; // 文件名为空时不允许确认
      }
      const fullPath = joinPath(currentDirectory, fileName);
      const fileMetadata: FileMetadata = {
        path: fullPath,
        name: fileName,
        parentPath: currentDirectory,
        size: 0,
        mimeType: 'application/octet-stream',
        createdAt: new Date(),
        modifiedAt: new Date(),
      };
      closePicker([fileMetadata]);
    } else {
      // 打开模式：使用选择的文件
      if (selectedItems.length > 0) {
        closePicker(selectedItems as FileMetadata[]);
      }
    }
  }, [pickerState.options, selectedItems, inputFileName, currentDirectory, closePicker]);

  const pickFiles = useCallback((options?: FilePickerOptions): Promise<FileMetadata[]> => {
    return openPicker(options);
  }, [openPicker]);

  const contextValue: FilePickerContextValue = {
    pickFiles,
  };

  const dialogTitle = pickerState.options.title || 
    (pickerState.options.mode === 'save' ? t`Save File` : 
     pickerState.options.multiSelect ? t`Select Files` : t`Open File`);

  const { mode, multiSelect } = pickerState.options;
  const saveNameError = mode === 'save' && inputFileName.trim().length > 0
    ? validateName(inputFileName.trim()).error
    : undefined;
  const dialogDescription = mode === 'save'
    ? (saveNameError ?? t`Current directory: ${currentDirectory}`)
    : (pickerState.options.multiSelect ? t`Selected ${selectedItems.length} files` : undefined);
  const showSelectionBar = !multiSelect; // 单选模式下显示选择栏
  const canConfirm = multiSelect 
    ? selectedItems.length > 0 
    : (mode === 'save'
        ? inputFileName.trim().length > 0 && validateName(inputFileName.trim()).valid
        : selectedItems.length > 0);

  return (
    <FilePickerContext.Provider value={contextValue}>
      {children}

      {/* 文件选择器对话框 */}
      <Dialog.Root open={pickerState.isOpen} onOpenChange={(open) => !open && handleCancel()} size='full'>
        <Dialog.Title>
          {dialogTitle}
        </Dialog.Title>
        <Dialog.Description>
          {dialogDescription}
        </Dialog.Description>

        <Dialog.Body>
          <FileSystemBrowser
            key={browserKey}
            fileSystem={fileSystem}
            initialPath={currentDirectory}
            onFileSelect={handleFileSelect}
            onFileDoubleClick={handleFileDoubleClick}
            onCurrentDirectoryChange={setCurrentDirectory}
            allowUpload={pickerState.options.allowUpload}
            multiSelect={pickerState.options.multiSelect}
          />
        </Dialog.Body>

        <Dialog.Footer>
          {showSelectionBar && (
            <div className={styles.selectionBar}>
              <label className={styles.selectionBarLabel}>
                {mode === 'save' ? t`File name:` : t`Selected file:`}
              </label>
              <input
                type="text"
                className={styles.selectionBarInput}
                value={inputFileName}
                onChange={(e) => setInputFileName(e.target.value)}
                placeholder={mode === 'save' ? t`Enter file name` : t`No file selected`}
                readOnly={mode !== 'save'}
                disabled={mode !== 'save'}
              />
            </div>
          )}
          <div className={styles.selectionBarButtons}>
            <Dialog.Close asChild>
              <Dialog.Button onClick={handleCancel}>
                {t`Cancel`}
              </Dialog.Button>
            </Dialog.Close>
            <Dialog.Button 
              variant="primary" 
              onClick={handleConfirm}
              disabled={!canConfirm}
            >
              {mode === 'save' ? t`Save` : multiSelect ? t`Confirm Selection (${selectedItems.length})` : t`Open`}
            </Dialog.Button>
          </div>
        </Dialog.Footer>

        <Dialog.CloseButton />
      </Dialog.Root>
    </FilePickerContext.Provider>
  );
};

