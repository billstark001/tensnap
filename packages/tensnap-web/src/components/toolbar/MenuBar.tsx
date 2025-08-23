import React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useFileOperations } from './FileOperationsProvider';
import * as styles from '../../styles/toolbar.css';
import { useSettingsStore } from '@/store/settings';

export interface MenuBarProps {
  className?: string;
}

export const MenuBar: React.FC<MenuBarProps> = ({
  className,
}) => {
  const {
    canSaveFile,
    onNewFile, onFileOpen, onDirectoryOpen,
    onFileSave, onFileSaveAs,
    onExport, onOpenBrowser
  } = useFileOperations();

  const setSettingsDialogOpen = useSettingsStore(x => x.setSettingsDialogOpen);

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
                onClick={onFileOpen}
              >
                打开文件
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={onDirectoryOpen}
              >
                打开文件夹
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={canSaveFile ? onFileSave : undefined}
                disabled={!canSaveFile}
              >
                保存
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={canSaveFile ? onFileSaveAs : undefined}
                disabled={!canSaveFile}
              >
                另存为...
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={onExport}
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
                onClick={onOpenBrowser}
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
                onClick={onOpenBrowser}
              >
                文件管理器
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={() => setSettingsDialogOpen(true)}
              >
                设置
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={styles.dropdownSeparator} />
              <DropdownMenu.Item
                className={styles.dropdownItem}
                onClick={onExport}
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

    </>
  );
};
