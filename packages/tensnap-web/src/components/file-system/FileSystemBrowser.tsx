import React, { useState, useRef, useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { useFileSystem } from '../../store/file-system/provider';
import { DirectoryEntry, FileMetadata, DirectoryMetadata } from '../../types/file';
import * as styles from './FileSystemBrowser.css';
import * as dialogStyles from '../../styles/dialog.css';

export interface FileSystemBrowserProps {
  onFileSelect?: (file: FileMetadata) => void;
  onDirectorySelect?: (directory: DirectoryMetadata) => void;
  allowUpload?: boolean;
  multiSelect?: boolean;
  className?: string;
}

export const FileSystemBrowser: React.FC<FileSystemBrowserProps> = ({
  onFileSelect,
  onDirectorySelect,
  allowUpload = true,
  multiSelect = false,
  className = ''
}) => {
  const fileSystem = useFileSystem();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDragOver, setIsDragOver] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');

  // 从 store 中获取状态和方法
  const {
    currentDirectory,
    directoryContents,
    loading,
    error,
    refreshCurrentDirectory,
    setCurrentDirectory,
    createFile,
    createDirectory,
    deleteFile,
    deleteDirectory,
    exportDirectory,
  } = fileSystem;
  // 面包屑导航
  const breadcrumbParts = currentDirectory.split('/').filter(Boolean);
  
  const handleBreadcrumbClick = useCallback(async (index: number) => {
    if (index === -1) {
      await setCurrentDirectory('/');
    } else {
      const newPath = '/' + breadcrumbParts.slice(0, index + 1).join('/');
      await setCurrentDirectory(newPath);
    }
  }, [breadcrumbParts, setCurrentDirectory]);

  // 项目选择
  const handleItemClick = useCallback((entry: DirectoryEntry) => {
    if (entry.type === 'directory') {
      if (onDirectorySelect) {
        onDirectorySelect(entry.metadata as DirectoryMetadata);
      } else {
        setCurrentDirectory(entry.metadata.path);
      }
    } else {
      if (onFileSelect) {
        onFileSelect(entry.metadata as FileMetadata);
      }
    }

    if (multiSelect) {
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        if (newSet.has(entry.metadata.id)) {
          newSet.delete(entry.metadata.id);
        } else {
          newSet.add(entry.metadata.id);
        }
        return newSet;
      });
    } else {
      setSelectedItems(new Set([entry.metadata.id]));
    }
  }, [onFileSelect, onDirectorySelect, multiSelect, setCurrentDirectory]);

  // 文件上传
  const handleFileUpload = useCallback(async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const content = await file.arrayBuffer();
      
      await createFile({
        name: file.name,
        path: `${currentDirectory}/${file.name}`,
        parentPath: currentDirectory,
        size: file.size,
        mimeType: file.type || 'application/octet-stream'
      }, content);
    }
    
    await refreshCurrentDirectory();
  }, [createFile, currentDirectory, refreshCurrentDirectory]);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      handleFileUpload(files);
    }
    // Reset the input value so the same file can be uploaded again
    event.target.value = '';
  }, [handleFileUpload]);

  // 拖拽上传
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

    const files = event.dataTransfer.files;
    if (files.length > 0) {
      await handleFileUpload(files);
    }
  }, [handleFileUpload]);

  // 创建新项目
  const handleCreateItem = useCallback(async () => {
    if (!newItemName.trim()) return;

    try {
      if (newItemType === 'file') {
        await createFile({
          name: newItemName,
          path: `${currentDirectory}/${newItemName}`,
          parentPath: currentDirectory,
          size: 0,
          mimeType: 'text/plain'
        }, '');
      } else {
        await createDirectory({
          name: newItemName,
          path: `${currentDirectory}/${newItemName}`,
          parentPath: currentDirectory
        });
      }
      
      await refreshCurrentDirectory();
      setShowCreateDialog(false);
      setNewItemName('');
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  }, [newItemName, newItemType, createFile, createDirectory, currentDirectory, refreshCurrentDirectory]);

  // 删除项目
  const handleDeleteItem = useCallback(async (entry: DirectoryEntry) => {
    try {
      if (entry.type === 'file') {
        await deleteFile(entry.metadata.id);
      } else {
        await deleteDirectory(entry.metadata.id, true);
      }
      
      await refreshCurrentDirectory();
    } catch (error) {
      console.error('Failed to delete item:', error);
    }
  }, [deleteFile, deleteDirectory, refreshCurrentDirectory]);

  // 导出目录
  const handleExportDirectory = useCallback(async (format: 'json' | 'zip') => {
    try {
      const blob = await exportDirectory(currentDirectory, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${currentDirectory.replace(/\//g, '-')}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export directory:', error);
    }
  }, [exportDirectory, currentDirectory]);

  // 格式化文件大小
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }, []);

  // 格式化日期
  const formatDate = useCallback((date: Date): string => {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }, []);

  return (
    <div 
      className={`${styles.browserContainer} ${className}`}
      onDragOver={allowUpload ? handleDragOver : undefined}
      onDragLeave={allowUpload ? handleDragLeave : undefined}
      onDrop={allowUpload ? handleDrop : undefined}
    >
      {/* 头部导航 */}
      <div className={styles.browserHeader}>
        <div className={styles.breadcrumbs}>
          <span 
            className={currentDirectory === '/' ? styles.breadcrumbCurrent : styles.breadcrumbItem}
            onClick={() => handleBreadcrumbClick(-1)}
          >
            根目录
          </span>
          {breadcrumbParts.map((part: string, index: number) => (
            <React.Fragment key={index}>
              <span className={styles.breadcrumbSeparator}>/</span>
              <span 
                className={index === breadcrumbParts.length - 1 ? styles.breadcrumbCurrent : styles.breadcrumbItem}
                onClick={() => handleBreadcrumbClick(index)}
              >
                {part}
              </span>
            </React.Fragment>
          ))}
        </div>

        <div className={styles.actionButtons}>
          <button 
            className={styles.actionButton}
            onClick={() => refreshCurrentDirectory()}
            disabled={loading}
          >
            刷新
          </button>

          <button 
            className={styles.actionButton}
            onClick={() => setShowCreateDialog(true)}
          >
            新建
          </button>

          {allowUpload && (
            <button 
              className={styles.primaryButton}
              onClick={handleUploadClick}
              disabled={loading}
            >
              上传文件
            </button>
          )}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className={styles.actionButton}>
                更多操作
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="bg-white border rounded-lg shadow-lg p-1 min-w-[150px]">
                <DropdownMenu.Item 
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded"
                  onClick={() => handleExportDirectory('json')}
                >
                  导出为JSON
                </DropdownMenu.Item>
                <DropdownMenu.Item 
                  className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded"
                  onClick={() => handleExportDirectory('zip')}
                >
                  导出为ZIP
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={styles.hiddenFileInput}
            onChange={handleFileInputChange}
          />
        </div>
      </div>

      {/* 内容区域 */}
      <div className={styles.browserContent}>
        {loading && (
          <div className={styles.loadingState}>
            正在加载...
          </div>
        )}

        {error && (
          <div className={styles.errorState}>
            <div>加载失败: {error}</div>
            <button 
              className={styles.actionButton}
              onClick={() => refreshCurrentDirectory()}
            >
              重试
            </button>
          </div>
        )}

        {!loading && !error && directoryContents.length === 0 && (
          <div className={styles.emptyState}>
            <div>此目录为空</div>
            {allowUpload && (
              <div 
                className={isDragOver ? styles.uploadAreaActive : styles.uploadArea}
                onClick={handleUploadClick}
              >
                <div className={styles.uploadText}>
                  拖拽文件到此处或点击上传
                </div>
                <div className={styles.uploadHint}>
                  支持多文件上传
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !error && directoryContents.length > 0 && (
          <div className={styles.contentList}>
            {directoryContents.map((entry: DirectoryEntry) => (
              <div
                key={entry.metadata.id}
                className={selectedItems.has(entry.metadata.id) ? styles.listItemSelected : styles.listItem}
                onClick={() => handleItemClick(entry)}
              >
                <div className={styles.itemIcon}>
                  {entry.type === 'directory' ? '📁' : '📄'}
                </div>
                
                <div className={styles.itemContent}>
                  <div className={styles.itemName}>
                    {entry.metadata.name}
                  </div>
                  <div className={styles.itemDetails}>
                    {entry.type === 'file' 
                      ? `${formatFileSize((entry.metadata as FileMetadata).size)} • ${formatDate(entry.metadata.modifiedAt)}`
                      : `目录 • ${formatDate(entry.metadata.modifiedAt)}`
                    }
                  </div>
                </div>

                <div className={styles.itemActions}>
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button 
                        className={styles.itemActionButton}
                        onClick={(e) => e.stopPropagation()}
                      >
                        ⋮
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content className="bg-white border rounded-lg shadow-lg p-1 min-w-[120px]">
                        <DropdownMenu.Item 
                          className="px-3 py-2 text-sm cursor-pointer hover:bg-gray-100 rounded text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(entry);
                          }}
                        >
                          删除
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 创建新项目对话框 */}
      <Dialog.Root open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogStyles.dialogOverlay} />
          <Dialog.Content className={dialogStyles.dialogContent}>
            <Dialog.Title className={dialogStyles.dialogTitle}>
              创建新项目
            </Dialog.Title>
            
            <div>
              <fieldset className={dialogStyles.dialogFieldset}>
                <label className={dialogStyles.dialogLabel}>
                  类型
                </label>
                <select 
                  value={newItemType}
                  onChange={(e) => setNewItemType(e.target.value as 'file' | 'directory')}
                  className={dialogStyles.dialogInput}
                >
                  <option value="file">文件</option>
                  <option value="directory">目录</option>
                </select>
              </fieldset>
              
              <fieldset className={dialogStyles.dialogFieldset}>
                <label className={dialogStyles.dialogLabel}>
                  名称
                </label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className={dialogStyles.dialogInput}
                  placeholder={`输入${newItemType === 'file' ? '文件' : '目录'}名称`}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateItem()}
                />
              </fieldset>
            </div>

            <div className={dialogStyles.dialogFooter}>
              <Dialog.Close asChild>
                <button className={dialogStyles.dialogButton}>
                  取消
                </button>
              </Dialog.Close>
              <button 
                className={dialogStyles.dialogButtonPrimary}
                onClick={handleCreateItem}
                disabled={!newItemName.trim()}
              >
                创建
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};
