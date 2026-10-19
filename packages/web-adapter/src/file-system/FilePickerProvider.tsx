import type { ReactNode } from 'react';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Dialog } from '@tensnap/web-common/components/ui';
import { t } from '@lingui/core/macro';
import { FileSystemBrowser } from './FileSystemBrowser';
import type {
  FileMetadata,
  DirectoryEntry,
  FilePickerOptions,
  FileSystemAdapter,
} from '@tensnap/web-common/types/file';
import type { FilePickerContextValue } from './FilePickerContext';
import { FilePickerContext } from './FilePickerContext';
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
    options: {},
  });

  const [selectedItems, setSelectedItems] = useState<DirectoryEntry[]>([]);
  const [inputFileName, setInputFileName] = useState<string>('');
  const [currentDirectory, setCurrentDirectory] = useState<string>('/');
  const [browserKey, setBrowserKey] = useState(0);
  const resolveRef = useRef<((result: FileMetadata[]) => void) | null>(null);

  useEffect(
    () => () => {
      resolveRef.current?.([]);
      resolveRef.current = null;
    },
    [],
  );

  const openPicker = useCallback((options: FilePickerOptions = {}): Promise<FileMetadata[]> => {
    return new Promise((resolve) => {
      resolveRef.current?.([]);
      resolveRef.current = resolve;
      setSelectedItems([]);
      setInputFileName('');
      setCurrentDirectory('/');
      setBrowserKey((prev) => prev + 1);
      setPickerState({
        isOpen: true,
        options,
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
      options: {},
    });
    setSelectedItems([]);
    setInputFileName('');
    setCurrentDirectory('/');
  }, []);

  const handleCancel = useCallback(() => {
    closePicker([]);
  }, [closePicker]);

  const handleFileSelect = useCallback(
    (entry: DirectoryEntry) => {
      const { multiSelect } = pickerState.options;

      if (entry.type === 'directory') {
        return;
      }

      if (multiSelect) {
        setSelectedItems((prev) => {
          const exists = prev.find((item) => item.path === entry.path);
          if (exists) {
            return prev.filter((item) => item.path !== entry.path);
          } else {
            return [...prev, entry];
          }
        });
      } else {
        // Selecting a single file does not confirm the dialog.
        setSelectedItems([entry]);
        setInputFileName(entry.name);
      }
    },
    [pickerState.options],
  );

  const handleFileDoubleClick = useCallback(
    (entry: DirectoryEntry) => {
      // Double-clicking a file confirms the selection immediately.
      if (entry.type === 'file') {
        closePicker([entry as FileMetadata]);
      }
    },
    [closePicker],
  );

  const handleConfirm = useCallback(() => {
    const { mode, multiSelect } = pickerState.options;
    const fileName = inputFileName.trim();

    if (multiSelect) {
      closePicker(selectedItems as FileMetadata[]);
    } else if (mode === 'save') {
      const validation = validateName(fileName);
      if (!validation.valid) {
        return;
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
      if (selectedItems.length > 0) {
        closePicker(selectedItems as FileMetadata[]);
      }
    }
  }, [pickerState.options, selectedItems, inputFileName, currentDirectory, closePicker]);

  const pickFiles = useCallback(
    (options?: FilePickerOptions): Promise<FileMetadata[]> => {
      return openPicker(options);
    },
    [openPicker],
  );

  const contextValue: FilePickerContextValue = {
    pickFiles,
  };

  const dialogTitle =
    pickerState.options.title ||
    (pickerState.options.mode === 'save'
      ? t`Save File`
      : pickerState.options.multiSelect
        ? t`Select Files`
        : t`Open File`);

  const { mode, multiSelect } = pickerState.options;
  const saveNameError =
    mode === 'save' && inputFileName.trim().length > 0
      ? validateName(inputFileName.trim()).error
      : undefined;
  const dialogDescription =
    mode === 'save'
      ? (saveNameError ?? t`Current directory: ${currentDirectory}`)
      : pickerState.options.multiSelect
        ? t`Selected ${selectedItems.length} files`
        : undefined;
  const showSelectionBar = !multiSelect;
  const canConfirm = multiSelect
    ? selectedItems.length > 0
    : mode === 'save'
      ? inputFileName.trim().length > 0 && validateName(inputFileName.trim()).valid
      : selectedItems.length > 0;

  return (
    <FilePickerContext.Provider value={contextValue}>
      {children}

      <Dialog.Root
        type="FilePickerProvider"
        title={dialogTitle}
        open={pickerState.isOpen}
        onOpenChange={(open) => !open && handleCancel()}
        size="full"
      >
        <Dialog.Description>{dialogDescription}</Dialog.Description>

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
              <Dialog.Button onClick={handleCancel}>{t`Cancel`}</Dialog.Button>
            </Dialog.Close>
            <Dialog.Button variant="primary" onClick={handleConfirm} disabled={!canConfirm}>
              {mode === 'save'
                ? t`Save`
                : multiSelect
                  ? t`Confirm Selection (${selectedItems.length})`
                  : t`Open`}
            </Dialog.Button>
          </div>
        </Dialog.Footer>
      </Dialog.Root>
    </FilePickerContext.Provider>
  );
};
