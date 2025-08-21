import { useState } from "react";
import { useSettingsStore } from "@/store/settings";
import { MenuBar } from './toolbar/MenuBar';
import { ToolBar } from './toolbar/ToolBar';
import { TabBar, Tab } from './toolbar/TabBar';
import * as styles from '../styles/toolbar.css';

export const ToolBarLayout = () => {
  const { theme, toggleTheme } = useSettingsStore();
  
  // 管理标签页状态
  const [tabs, setTabs] = useState<Tab[]>([
    { id: '1', title: 'Welcome', content: <div className="p-4">Welcome to TenSnap!</div> },
    { id: '2', title: 'Model 1', content: <div className="p-4">Model 1 content</div> },
  ]);
  const [activeTabId, setActiveTabId] = useState('1');

  const handleNewTab = () => {
    const newTab: Tab = {
      id: `tab-${Date.now()}`,
      title: `New Tab ${tabs.length + 1}`,
      content: <div className="p-4">New tab content</div>
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleTabClose = (tabId: string) => {
    setTabs(tabs.filter(tab => tab.id !== tabId));
  };

  const handleTabChange = (tabId: string) => {
    setActiveTabId(tabId);
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