import React, { useState, useCallback, useEffect } from 'react';
import { DirectoryEntry, FileSystemAdapter } from 'tensnap-web/types/file';
import { Breadcrumbs } from './Breadcrumbs';
import { ActionButtons } from './ActionButtons';
import { FileItem } from './FileItem';
import { EmptyState } from './EmptyState';
import { CreateDialog } from './CreateDialog';
import { normalizePath, joinPath, validateName, readFileContent } from './utils';
import clsx from 'clsx';
import * as styles from './FileSystemBrowser.css';
import { ExportDialog } from './ExportDialog';

export interface FileSystemBrowserProps {
  fileSystem: FileSystemAdapter;
  initialPath?: string;
  onFileSelect?: (file: DirectoryEntry) => void;
  onFileDoubleClick?: (file: DirectoryEntry) => void;
  onDirectorySelect?: (directory: DirectoryEntry) => void;
  allowUpload?: boolean;
  multiSelect?: boolean;
  className?: string;
}

export const FileSystemBrowser: React.FC<FileSystemBrowserProps> = ({
  fileSystem,
  initialPath = '/',
  onFileSelect,
  onFileDoubleClick,
  onDirectorySelect,
  allowUpload = true,
  multiSelect = false,
  className,
}) => {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [currentDirectory, setCurrentDirectoryRaw] = useState(normalizePath(initialPath));
  const [directoryContents, setDirectoryContentsRaw] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  // 加载目录内容
  const loadDirectory = useCallback(async (path: string) => {
    const normalizedPath = normalizePath(path);
    setLoading(true);
    setError(null);
    setSelectedItems(new Set()); // 清除选择
    
    try {
      const entries = await fileSystem.list(normalizedPath);
      setCurrentDirectoryRaw(normalizedPath);
      setDirectoryContentsRaw(entries);
    } catch (err) {
      console.error('Failed to load directory:', err);
      setError((err as Error).message || '加载目录失败');
      setDirectoryContentsRaw([]);
    } finally {
      setLoading(false);
    }
  }, [fileSystem]);

  // 初始化：加载初始目录
  useEffect(() => {
    loadDirectory(currentDirectory);
  }, [loadDirectory]);

  // 刷新当前目录
  const refreshCurrentDirectory = useCallback(() => {
    loadDirectory(currentDirectory);
  }, [currentDirectory, loadDirectory]);

  // 切换目录
  const setCurrentDirectory = useCallback((path: string) => {
    loadDirectory(path);
  }, [loadDirectory]);

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
      // 如果有自定义的目录选择处理，使用它；否则导航到该目录
      if (onDirectorySelect) {
        onDirectorySelect(entry);
      } else {
        setCurrentDirectory(entry.path);
      }
    } else {
      // 文件选择
      if (onFileSelect) {
        onFileSelect(entry);
      }
    }

    // 更新选择状态
    if (multiSelect) {
      toggleItemSelection(entry.path);
    } else {
      setSelectedItems(new Set([entry.path]));
    }
  }, [onFileSelect, onDirectorySelect, multiSelect, setCurrentDirectory, toggleItemSelection]);

  const handleItemDoubleClick = useCallback((entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      // 双击目录时导航
      setCurrentDirectory(entry.path);
    } else {
      // 双击文件时触发双击回调
      if (onFileDoubleClick) {
        onFileDoubleClick(entry);
      }
    }
  }, [onFileDoubleClick, setCurrentDirectory]);

  // 文件上传处理
  const handleFileUpload = useCallback(async (files: FileList) => {
    setLoading(true);
    setError(null);
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const content = await readFileContent(file);
        const filePath = joinPath(currentDirectory, file.name);
        await fileSystem.writeFile(filePath, content, {
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream'
        });
      });
      
      await Promise.all(uploadPromises);
      await refreshCurrentDirectory();
    } catch (err) {
      console.error('Failed to upload files:', err);
      setError((err as Error).message || '上传文件失败');
    } finally {
      setLoading(false);
    }
  }, [fileSystem, currentDirectory, refreshCurrentDirectory]);

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
    // 验证名称
    const validation = validateName(itemName);
    if (!validation.valid) {
      setError(validation.error || '无效的名称');
      throw new Error(validation.error || '无效的名称');
    }

    setLoading(true);
    setError(null);
    try {
      const itemPath = joinPath(currentDirectory, itemName);
      
      if (itemType === 'file') {
        await fileSystem.writeFile(itemPath, '', {
          name: itemName,
          size: 0,
          mimeType: 'text/plain'
        });
      } else {
        await fileSystem.createDirectory(itemPath);
      }

      await refreshCurrentDirectory();
    } catch (err) {
      console.error('Failed to create item:', err);
      const errorMsg = (err as Error).message || '创建失败';
      setError(errorMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fileSystem, currentDirectory, refreshCurrentDirectory]);

  // 删除操作
  const handleDeleteItem = useCallback(async (entry: DirectoryEntry) => {
    if (!confirm(`确定要删除 "${entry.name}" 吗？${entry.type === 'directory' ? '这将删除其中的所有内容。' : ''}`)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (entry.type === 'file') {
        await fileSystem.deleteFile(entry.path);
      } else {
        await fileSystem.deleteDirectory(entry.path, true);
      }
      await refreshCurrentDirectory();
    } catch (err) {
      console.error('Failed to delete item:', err);
      setError((err as Error).message || '删除失败');
    } finally {
      setLoading(false);
    }
  }, [fileSystem, refreshCurrentDirectory]);

  // 导出操作 - 现在由外部提供
  const handleExportDirectory = useCallback(() => {
    setShowExportDialog(true);
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
                onItemDoubleClick={handleItemDoubleClick}
                onDelete={handleDeleteItem}
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

      <ExportDialog
        fileSystem={fileSystem}
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        currentPath={currentDirectory}
      />
    </div>
  );
};
