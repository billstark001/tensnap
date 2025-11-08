import { MenuBar } from './MenuBar';
import { TabBar } from './TabBar';
import { useProjectStore } from "@/store/project";
import { FileOperationsProvider } from './FileOperationsProvider';

import * as styles from '../../styles/toolbar.css';
import * as Tooltip from '@radix-ui/react-tooltip';
import { FileOperationTools, SettingTools, SimulationControlTools, UndoRedoTools, ViewTools } from "./ToolGroups";

const Separator = () => <div className={styles.separator} />;

export const ToolBarLayout = () => {

  const {
    activeIndex,
    setActive,
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
    <FileOperationsProvider>
      <Tooltip.Provider>
        <div className={styles.toolbar}>

          <MenuBar />

          <div className={styles.toolBarRow}>

            <FileOperationTools />
            <Separator />

            <UndoRedoTools />
            <Separator />

            <SimulationControlTools />
            <Separator />

            <ViewTools />
            <Separator />

            <SettingTools />

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

      </Tooltip.Provider>
    </FileOperationsProvider>
  );
};