import { useSettingsStore } from "@/store/settings";
import { MenuBar } from './toolbar/MenuBar';
import { ToolBar } from './toolbar/ToolBar';
import { TabBar } from './toolbar/TabBar';
import { useProjectStore } from "@/store/project";

import * as styles from '../styles/toolbar.css';

export const ToolBarLayout = () => {
  const { theme, toggleTheme } = useSettingsStore();

  const { 
    setActive,
    activeIndex,
    getDisplayNames,
    new: createNewProject,
    close,
  } = useProjectStore();

  // 管理标签页状态
  const tabs = getDisplayNames();
  const activeTabId = activeIndex != null ? tabs[activeIndex].id : undefined;

  const handleNewTab = () => {
    createNewProject('http://localhost:8765');
  };

  const handleTabClose = (tabId: string) => {
    close(tabs.findIndex(tab => tab.id === tabId));
  };

  const handleTabChange = (tabId: string) => {
    setActive(tabs.findIndex(tab => tab.id === tabId));
  };

  return (
    <div className={styles.toolbar}>
      {/* 菜单栏 */}
      <MenuBar />
      
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
  );
};