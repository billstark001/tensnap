import { createContext, useContext } from 'react';
import { FileSystemPicker } from '@tensnap/web-common/types/file';

export interface FilePickerContextValue {
  pickFiles: FileSystemPicker['pickFiles'];
}

export const FilePickerContext = createContext<FilePickerContextValue | null>(null);

export const useFilePicker = (): FilePickerContextValue => {
  const context = useContext(FilePickerContext);
  if (!context) {
    throw new Error('useFilePicker must be used within a FilePickerProvider');
  }
  return context;
};