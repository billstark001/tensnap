import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import * as styles from '@/styles/toolbar.css';
import clsx from 'clsx';
import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';

export interface Tab {
  id: string;
  name: string;
  content?: React.ReactNode;
}

export interface TabBarProps {
  tabs: Tab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
  onNewTab?: () => void;
  className?: string;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onNewTab,
  className
}) => {
  const { _ } = useLingui();

  const [localActiveTab, setLocalActiveTab] = useState(tabs[0]?.id || '');
  const currentActiveTab = activeTabId || localActiveTab;

  const handleTabChange = (tabId: string) => {
    setLocalActiveTab(tabId);
    onTabChange?.(tabId);
  };

  const handleTabClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    onTabClose?.(tabId);

    // 如果关闭的是当前活动标签，切换到另一个标签
    if (tabId === currentActiveTab && tabs.length > 1) {
      const currentIndex = tabs.findIndex(tab => tab.id === tabId);
      const nextTab = tabs[currentIndex + 1] || tabs[currentIndex - 1];
      if (nextTab) {
        handleTabChange(nextTab.id);
      }
    }
  };

  return (
    <Tabs.Root value={currentActiveTab} onValueChange={handleTabChange}>
      <div className={clsx(styles.tabsContainer, className)}>
        <Tabs.List style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.id}
              value={tab.id}
              className={currentActiveTab === tab.id ? styles.activeTab : styles.tab}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>{tab.name}</span>
              <span
                className={styles.tabCloseButton}
                onClick={(e) => handleTabClose(e, tab.id)}
                aria-label={_(msg`Close ${tab.name}`)}
              >
                ×
              </span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* 新建标签页按钮 */}
        <button
          className={styles.newTabButton}
          onClick={onNewTab}
          aria-label={_(msg`New Tab`)}
        >
          +
        </button>
      </div>

      {/* 标签页内容区域 */}
      {tabs.map((tab) => (
        <Tabs.Content
          key={tab.id}
          value={tab.id}
          style={{ flex: 1 }}
        >
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
};
