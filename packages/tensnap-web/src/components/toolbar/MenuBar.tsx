import React, { useState, useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { FilePickerFactory, FilePickerResult } from '../../utils/file-picker';
import { FileSystemBrowser } from '../file-system/FileSystemBrowser';
import { useAdapter, UseFileSystemGuard } from '../../store/file-system/provider';
import * as styles from '../../styles/toolbar.css';
import * as dialogStyles from '../../styles/dialog.css';

export interface MenuBarProps {
  className?: string;
  onFileOpen?: (files: any[]) => void;
  onFileSave?: () => void;
  onExport?: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({ 
  className, 
  onFileOpen,
  onFileSave,
  onExport 
}) => {
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const { fileSystemStore } = useAdapter();

  // 注册 React 文件选择器
  React.useEffect(() => {
    FilePickerFactory.registerReactPicker(async (): Promise<FilePickerResult> => {
      return new Promise((resolve) => {
        // 这里可以打开文件浏览器对话框
        setShowFileBrowser(true);
        
        // 临时解决方案：返回空结果
        // 实际应该等待用户在浏览器中选择文件
        setTimeout(() => {
          resolve({ files: [], directories: [], cancelled: true });
        }, 100);
      });
    });
  }, []);

  const handleFileOpen = useCallback(async () => {
    const picker = FilePickerFactory.getDefaultPicker();
    if (!picker) {
      console.error('No file picker available');
      return;
    }

    try {
      const result = await picker.pickFiles({
        multiple: true,
        filters: [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Text Files', extensions: ['txt', 'md', 'json'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] }
        ]
      });

      if (!result.cancelled && result.files.length > 0) {
        onFileOpen?.(result.files);
      }
    } catch (error) {
      console.error('Failed to open files:', error);
    }
  }, [onFileOpen]);

  const handleDirectoryOpen = useCallback(async () => {
    const picker = FilePickerFactory.getDefaultPicker();
    if (!picker) {
      console.error('No file picker available');
      return;
    }

    try {
      const result = await picker.pickFiles({
        mode: 'directories'
      });

      if (!result.cancelled && result.directories.length > 0) {
        console.log('Selected directories:', result.directories);
        // 这里可以处理目录选择
      }
    } catch (error) {
      console.error('Failed to open directory:', error);
    }
  }, []);

  const handleExportCurrentDirectory = useCallback(async () => {
    if (!fileSystemStore) return;

    try {
      const currentDir = fileSystemStore((state) => state.currentDirectory);
      const exportDir = fileSystemStore((state) => state.exportDirectory);
      
      const blob = await exportDir(currentDir, 'zip');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `export-${currentDir.replace(/\//g, '-')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export directory:', error);
    }
  }, [fileSystemStore]);

  return (
    <>
      <div className={`${styles.menuBar} ${className || ''}`}>
        {/* File 菜单 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}>文件</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={() => setShowFileBrowser(true)}
              >
                新建
              </DropdownMenu.Item>
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={handleFileOpen}
              >
                打开文件
              </DropdownMenu.Item>
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={handleDirectoryOpen}
              >
                打开文件夹
              </DropdownMenu.Item>
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={onFileSave}
              >
                保存
              </DropdownMenu.Item>
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={() => setShowFileBrowser(true)}
              >
                另存为...
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={() => setShowExportDialog(true)}
              >
                导出
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                退出
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Edit 菜单 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}>编辑</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item className={styles.dropdownItem}>
                撤销
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                重做
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                剪切
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                复制
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                粘贴
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                全选
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* View 菜单 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}>视图</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item className={styles.dropdownItem}>
                放大
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                缩小
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                重置缩放
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                显示网格
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                显示工具栏
              </DropdownMenu.Item>
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={() => setShowFileBrowser(true)}
              >
                文件浏览器
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                全屏
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Tools 菜单 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}>工具</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={() => setShowFileBrowser(true)}
              >
                文件管理器
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                设置
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item 
                className={styles.dropdownItem}
                onClick={handleExportCurrentDirectory}
              >
                导出当前目录
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* About 菜单 */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={styles.menuItem}>帮助</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={styles.dropdownContent}
              sideOffset={5}
            >
              <DropdownMenu.Item className={styles.dropdownItem}>
                帮助文档
              </DropdownMenu.Item>
              <DropdownMenu.Item className={styles.dropdownItem}>
                快捷键
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item className={styles.dropdownItem}>
                关于 TenSnap
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {/* 文件浏览器对话框 */}
      <Dialog.Root open={showFileBrowser} onOpenChange={setShowFileBrowser}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogStyles.dialogOverlay} />
          <Dialog.Content className={dialogStyles.dialogContentXLarge}>
            <div className={dialogStyles.dialogHeader}>
              <Dialog.Title className={dialogStyles.dialogTitle}>
                文件浏览器
              </Dialog.Title>
            </div>
            
            <div className={dialogStyles.dialogBody}>
              <UseFileSystemGuard>
              <FileSystemBrowser
                onFileSelect={(file) => {
                  console.log('Selected file:', file);
                  onFileOpen?.([file]);
                  setShowFileBrowser(false);
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

      {/* 导出对话框 */}
      <Dialog.Root open={showExportDialog} onOpenChange={setShowExportDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogStyles.dialogOverlay} />
          <Dialog.Content className={dialogStyles.dialogContent}>
            <Dialog.Title className={dialogStyles.dialogTitle}>
              导出选项
            </Dialog.Title>
            
            <div>
              <fieldset className={dialogStyles.dialogFieldset}>
                <label className={dialogStyles.dialogLabel}>
                  导出格式
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button 
                    className={dialogStyles.dialogButton}
                    style={{ 
                      padding: '12px', 
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '4px'
                    }}
                    onClick={() => {
                      handleExportCurrentDirectory();
                      setShowExportDialog(false);
                    }}
                  >
                    <div style={{ fontWeight: '500' }}>ZIP 压缩包</div>
                    <div style={{ fontSize: '12px', color: '#666666' }}>包含所有文件的压缩包</div>
                  </button>
                  
                  <button 
                    className={dialogStyles.dialogButton}
                    style={{ 
                      padding: '12px', 
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '4px'
                    }}
                    onClick={() => {
                      onExport?.();
                      setShowExportDialog(false);
                    }}
                  >
                    <div style={{ fontWeight: '500' }}>JSON 数据</div>
                    <div style={{ fontSize: '12px', color: '#666666' }}>结构化数据格式</div>
                  </button>
                </div>
              </fieldset>
            </div>

            <div className={dialogStyles.dialogFooter}>
              <Dialog.Close asChild>
                <button className={dialogStyles.dialogButton}>
                  取消
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
};
