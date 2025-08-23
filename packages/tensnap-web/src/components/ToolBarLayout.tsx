import { useSettingsStore } from "@/store/settings";
import { MenuBar } from './toolbar/MenuBar';
import { ToolBar } from './toolbar/ToolBar';
import { TabBar } from './toolbar/TabBar';
import { useProjectStore } from "@/store/project";
import { FileOperationsProvider } from './toolbar/FileOperationsProvider';

import * as styles from '../styles/toolbar.css';
import { useCallback, useState } from "react";
import { CreateNewDialog } from "./CreateNewDialog";
import { FileMetadata } from "@/types/file";
import { useWithLoading } from "@/store/loading";
import { SettingsDialog } from "./SettingsDialog";

export const ToolBarLayout = () => {
  const { 
    settingsDialogOpen, setSettingsDialogOpen,
    theme, toggleTheme,
  } = useSettingsStore();
  const withLoading = useWithLoading();

  const {
    setActive,
    activeIndex,
    getDisplayNames,
    new: createNewProject,
    open,
    close,
    save,
  } = useProjectStore();

  // 管理标签页状态
  const tabs = getDisplayNames();
  const activeTabId = activeIndex != null ? tabs[activeIndex].id : undefined;
  const canSaveFile = activeTabId != null;

  const handleNewTab = () => {
    createNewProject('http://localhost:8765');
  };

  const handleTabClose = (tabId: string) => {
    close(tabs.findIndex(tab => tab.id === tabId));
  };

  const handleTabChange = (tabId: string) => {
    setActive(tabs.findIndex(tab => tab.id === tabId));
  };

  const [isOpen, setOpen] = useState(false);

  const onNewFile = useCallback(() => {
    setOpen(true);
  }, []);

  const onCreateItem = useCallback((address: string) => {
    createNewProject(address);
    setOpen(false);
  }, [setOpen]);

  const onFileOpen = useCallback((files: FileMetadata[]) => {
    if (!files?.length) {
      return;
    }
    withLoading(() => open(files[0].path));
  }, [withLoading, open]);

  const onFileSave = useCallback((asPath?: string | null) => {
    withLoading(() => save(undefined, asPath ?? undefined));
  }, [withLoading, save]);

  return (
    <FileOperationsProvider
      onNewFile={onNewFile}
      onFileOpen={onFileOpen}
      onFileSave={onFileSave}
      canSaveFile={canSaveFile}
    >
      <div className={styles.toolbar}>
        {/* 菜单栏 */}
        <MenuBar />

        <CreateNewDialog open={isOpen} onOpenChange={setOpen} onCreateItem={onCreateItem} />

        {/* 工具栏 */}
        <div className={styles.toolBarRow}>
          <ToolBar />

          {/* 主题切换按钮 */}
          <button
            onClick={toggleTheme}
            className={styles.themeToggle}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>

        {/* 标签页 */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={handleTabChange}
          onTabClose={handleTabClose}
          onNewTab={handleNewTab}
        />
      </div>

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
    </FileOperationsProvider>
  );
};