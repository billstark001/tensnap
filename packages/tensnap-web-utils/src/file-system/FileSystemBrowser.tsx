import React, { useState, useCallback } from 'react';
import { DirectoryEntry, FileSystemAdapter } from 'tensnap-web/types/file';
import { Breadcrumbs } from './Breadcrumbs';
import { ActionButtons } from './ActionButtons';
import { FileItem } from './FileItem';
import { EmptyState } from './EmptyState';
import { CreateDialog } from './CreateDialog';
import clsx from 'clsx';
import * as styles from './FileSystemBrowser.css';

// Interface for file system operations needed by the browser
export interface FileSystemOperations {
  currentDirectory: string;
  directoryContents: DirectoryEntry[];
  loading: boolean;
  error: string | null;
  refreshCurrentDirectory: () => Promise<void>;
  setCurrentDirectory: (path: string) => Promise<void>;
  writeFile: (path: string, content: ArrayBuffer | string, metadata?: any) => Promise<any>;
  createDirectory: (path: string, allowExist?: boolean) => Promise<any>;
  deleteFile: (path: string) => Promise<void>;
  deleteDirectory: (path: string, recursive?: boolean) => Promise<void>;
}

export interface FileSystemBrowserProps {
  fileSystem: FileSystemAdapter;
  onFileSelect?: (file: DirectoryEntry) => void;
  onDirectorySelect?: (directory: DirectoryEntry) => void;
  allowUpload?: boolean;
  multiSelect?: boolean;
  className?: string;
}

export const FileSystemBrowser: React.FC<FileSystemBrowserProps> = ({
  fileSystem,
  onFileSelect,
  onDirectorySelect,
  allowUpload = true,
  multiSelect = false,
  className,
}) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [currentDirectory, setCurrentDirectoryRaw] = useState('/');
  const [directoryContents, setDirectoryContentsRaw] = useState<DirectoryEntry[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCurrentDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const listRes = await fileSystem.list(path);
      setCurrentDirectoryRaw(path);
      setDirectoryContentsRaw(listRes);
    } catch (error) {
      console.error('Failed to change directory:', error);
      setError((error as Error).message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);
  
  const refreshCurrentDirectory = useCallback(
    () => setCurrentDirectory(currentDirectory),
    [currentDirectory, setCurrentDirectory]
  );

  const {
    writeFile,
    createDirectory,
    deleteFile,
    deleteDirectory,
  } = fileSystem;

  // 处理项目选择
  const toggleItemSelection = useCallback((itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      newSet.has(itemId) ? newSet.delete(itemId) : newSet.add(itemId);
      return newSet;
    });
  }, []);

  const handleItemClick = useCallback((entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      onDirectorySelect?.(entry) ?? setCurrentDirectory(entry.path);
    } else {
      onFileSelect?.(entry);
    }

    if (multiSelect) {
      toggleItemSelection(entry.path);
    } else {
      setSelectedItems(new Set([entry.path]));
    }
  }, [onFileSelect, onDirectorySelect, multiSelect, setCurrentDirectory, toggleItemSelection]);

  // 文件上传处理
  const handleFileUpload = useCallback(async (files: FileList) => {
    setLoading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const content = await file.arrayBuffer();
        await writeFile(`${currentDirectory}/${file.name}`, content);
      }
      await refreshCurrentDirectory();
    } catch (error) {
      console.error('Failed to upload files:', error);
      setError((error as Error).message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [writeFile, currentDirectory, refreshCurrentDirectory]);

  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (files) handleFileUpload(files);
    event.target.value = ''; // 重置以允许重复上传相同文件
  }, [handleFileUpload]);

  // 拖拽处理
  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const { files } = event.dataTransfer;
    if (files.length > 0) await handleFileUpload(files);
  }, [handleFileUpload]);

  // 创建操作
  const handleCreateItem = useCallback(async (itemName: string, itemType: 'file' | 'directory') => {
    setLoading(true);
    setError(null);
    try {
      const itemPath = `${currentDirectory}/${itemName}`;
      if (itemType === 'file') {
        await writeFile(itemPath, '');
      } else {
        await createDirectory(itemPath);
      }

      await refreshCurrentDirectory();
    } catch (error) {
      console.error('Failed to create item:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [writeFile, createDirectory, currentDirectory, refreshCurrentDirectory]);

  // 删除操作
  const handleDeleteItem = useCallback(async (entry: DirectoryEntry) => {
    try {
      if (entry.type === 'file') {
        await deleteFile(entry.path);
      } else {
        await deleteDirectory(entry.path, true);
      }
      await refreshCurrentDirectory();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  }, [deleteFile, deleteDirectory, refreshCurrentDirectory]);

  // 导出操作 - 现在由外部提供
  const handleExportDirectory = useCallback(async (_format: 'json' | 'zip') => {
    console.warn('Export functionality should be provided by the adapter implementation');
  }, []);

  // 格式化工具函数
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }, []);

  const formatDate = useCallback((date: Date): string => {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }, []);

  const handleUploadClick = useCallback(() => {
    // 这个将由ActionButtons内部处理
  }, []);

  return (
    <div
      className={clsx(styles.browserContainer, className)}
      onDragOver={allowUpload ? handleDragOver : undefined}
      onDragLeave={allowUpload ? handleDragLeave : undefined}
      onDrop={allowUpload ? handleDrop : undefined}
    >
      {/* 头部导航 */}
      <div className={styles.browserHeader}>
        <Breadcrumbs
          currentDirectory={currentDirectory}
          onNavigate={setCurrentDirectory}
        />
        <ActionButtons
          loading={loading}
          allowUpload={allowUpload}
          onRefresh={refreshCurrentDirectory}
          onCreate={() => setShowCreateDialog(true)}
          onExport={handleExportDirectory}
          onFileInputChange={handleFileInputChange}
        />
      </div>

      {/* 内容区域 */}
      <div className={styles.browserContent}>
        {loading && (
          <div className={styles.loadingState}>正在加载...</div>
        )}

        {error && (
          <div className={styles.errorState}>
            <div>加载失败: {error}</div>
            <button className={styles.actionButton} onClick={refreshCurrentDirectory}>
              重试
            </button>
          </div>
        )}

        {!loading && !error && directoryContents.length === 0 && (
          <EmptyState
            allowUpload={allowUpload}
            isDragOver={isDragOver}
            onUploadClick={handleUploadClick}
          />
        )}

        {!loading && !error && directoryContents.length > 0 && (
          <div className={styles.contentList}>
            {directoryContents.map((entry) => (
              <FileItem
                key={entry.path}
                entry={entry}
                isSelected={selectedItems.has(entry.path)}
                onItemClick={handleItemClick}
                onDelete={handleDeleteItem}
                formatFileSize={formatFileSize}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      <CreateDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreateItem={handleCreateItem}
      />
    </div>
  );
};
