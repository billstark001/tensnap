import { useEffect } from 'react';
import { FileSystemPicker } from '@tensnap/web-common/types/file';
import { useFilePicker } from './FilePickerContext';

interface FilePickerBridgeProps {
  onPickFilesChanged: (pickFiles: FileSystemPicker['pickFiles']) => void;
}

export function FilePickerBridge({ onPickFilesChanged }: FilePickerBridgeProps) {
  const { pickFiles } = useFilePicker();

  useEffect(() => {
    onPickFilesChanged(pickFiles);
  }, [onPickFilesChanged, pickFiles]);

  return null;
}