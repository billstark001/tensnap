import React, { useState, useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { useFilePicker } from '../file-system/FilePickerProvider';
import { ExportDialog } from '../file-system/ExportDialog';
import { FileSystemBrowser } from '../file-system/FileSystemBrowser';
import { UseFileSystemGuard } from '../../store/file-system/provider';
import * as styles from '../../styles/toolbar.css';
import * as dialogStyles from '../../styles/dialog.css';
import { useCallbackRef } from '@/utils/react';
import { FileMetadata } from '@/types/file';

export interface MenuBarProps {
  className?: string;
  onNewFile?: () => void;
  onFileOpen?: (files: FileMetadata[]) => void;
  onFileSave?: (path: string | null) => void;
  onExport?: () => void;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  className,
  onNewFile: _onNewFile,
  onFileOpen: _onFileOpen,
  onFileSave: _onFileSave,
  onExport: _onExport
}) => {
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const filePicker = useFilePicker();

  const onNewFile = useCallbackRef(_onNewFile);
  const onFileOpen = useCallbackRef(_onFileOpen);
  const onFileSave = useCallbackRef(_onFileSave);
  const onExport = useCallbackRef(_onExport);

  const handleFileOpen = useCallback(async () => {
    try {
      const files = await filePicker.pickFiles({
        title: '选择文件',
        multiSelect: true,
        mode: 'files'
      });

      if (!files.cancelled && files.files.length > 0) {
        onFileOpen?.(files.files);
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
  }, [filePicker]);

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
                onClick={onNewFile}
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
                onClick={() => onFileSave(null)}
              >
                保存
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={handleSaveAs}
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
                onClick={() => setShowExportDialog(true)}
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
              <Dialog.Description></Dialog.Description>
            </div>

            <div className={dialogStyles.dialogBody}>
              <UseFileSystemGuard>
                <FileSystemBrowser
                  onFileSelect={(file) => {
                    console.log('Selected file:', file);
                    onFileOpen?.([file as FileMetadata]);
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
      <ExportDialog
        isOpen={showExportDialog}
        onOpenChange={setShowExportDialog}
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
    </>
  );
};
