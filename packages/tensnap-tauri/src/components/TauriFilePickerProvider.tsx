import React, { createContext, useContext, useCallback, ReactNode } from 'react';
import type { 
  FileMetadata, 
  DirectoryMetadata 
} from 'tensnap-web/types/file';
import { open } from '@tauri-apps/api/dialog';

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
    throw new Error('useFilePicker must be used within a TauriFilePickerProvider');
  }
  return context;
};

interface TauriFilePickerProviderProps {
  children: ReactNode;
}

export const TauriFilePickerProvider: React.FC<TauriFilePickerProviderProps> = ({ children }) => {
  const createFileMetadata = useCallback(async (path: string): Promise<FileMetadata> => {
    // Import the invoke function locally to avoid import issues
    const { invoke } = await import('@tauri-apps/api/tauri');
    
    const tauriMetadata = await invoke('get_file_metadata_handler', { path });
    
    return {
      name: (tauriMetadata as any).name,
      path: (tauriMetadata as any).path,
      parentPath: (tauriMetadata as any).parent_path,
      size: (tauriMetadata as any).size,
      mimeType: (tauriMetadata as any).mime_type,
      createdAt: new Date((tauriMetadata as any).created_at * 1000),
      modifiedAt: new Date((tauriMetadata as any).modified_at * 1000),
      tags: (tauriMetadata as any).tags,
      description: (tauriMetadata as any).description
    };
  }, []);

  const createDirectoryMetadata = useCallback((path: string): DirectoryMetadata => {
    const name = path.split('/').pop() || path.split('\\').pop() || path;
    const parentPath = path.includes('/') 
      ? path.substring(0, path.lastIndexOf('/'))
      : path.includes('\\')
      ? path.substring(0, path.lastIndexOf('\\'))
      : '.';
    
    return {
      name,
      path,
      parentPath,
      createdAt: new Date(),
      modifiedAt: new Date()
    };
  }, []);

  const pickFiles = useCallback(async (options: FilePickerOptions = {}): Promise<FilePickerResult> => {
    try {
      const dialogOptions = {
        title: options.title || '选择文件',
        multiple: options.multiSelect || false,
        filters: [
          {
            name: 'All Files',
            extensions: ['*']
          },
          {
            name: 'NumPy Files',
            extensions: ['npy', 'npz']
          },
          {
            name: 'JSON Files',
            extensions: ['json']
          },
          {
            name: 'Text Files',
            extensions: ['txt', 'md']
          }
        ]
      };

      const result = await open(dialogOptions);
      
      if (!result) {
        return {
          files: [],
          directories: [],
          cancelled: true
        };
      }

      const paths = Array.isArray(result) ? result : [result];
      const files: FileMetadata[] = [];
      
      for (const path of paths) {
        try {
          const fileMetadata = await createFileMetadata(path);
          files.push(fileMetadata);
        } catch (error) {
          console.error(`Failed to create metadata for file: ${path}`, error);
        }
      }

      return {
        files,
        directories: [],
        cancelled: false
      };
    } catch (error) {
      console.error('Failed to open file dialog:', error);
      return {
        files: [],
        directories: [],
        cancelled: true
      };
    }
  }, [createFileMetadata]);

  const pickFile = useCallback(async (options: Omit<FilePickerOptions, 'multiSelect'> = {}): Promise<FileMetadata | null> => {
    const result = await pickFiles({
      ...options,
      multiSelect: false
    });
    
    return result.cancelled ? null : result.files[0] || null;
  }, [pickFiles]);

  const pickDirectory = useCallback(async (options: Omit<FilePickerOptions, 'multiSelect' | 'mode'> = {}): Promise<DirectoryMetadata | null> => {
    try {
      const dialogOptions = {
        title: options.title || '选择文件夹',
        directory: true
      };

      const result = await open(dialogOptions);
      
      if (!result || Array.isArray(result)) {
        return null;
      }

      return createDirectoryMetadata(result);
    } catch (error) {
      console.error('Failed to open directory dialog:', error);
      return null;
    }
  }, [createDirectoryMetadata]);

  const contextValue: FilePickerContextValue = {
    pickFiles,
    pickFile,
    pickDirectory
  };

  return (
    <FilePickerContext.Provider value={contextValue}>
      {children}
    </FilePickerContext.Provider>
  );
};
