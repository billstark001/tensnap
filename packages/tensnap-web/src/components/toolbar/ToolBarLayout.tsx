import { MenuBar } from './MenuBar';
import { TabBar } from './TabBar';
import { useProjectStore } from "@/store/project";

import * as styles from '../../styles/toolbar.css';
import * as Tooltip from '@radix-ui/react-tooltip';
import { FileOperationTools, SettingTools, SimulationControlTools, UndoRedoTools, ViewTools } from "./ToolGroups";
import { useFileOperations } from './useFileOperations';

const Separator = () => <div className={styles.separator} />;

export const ToolBarLayout = () => {

  const setActive = useProjectStore((store) => store.setActive);
  const close = useProjectStore((store) => store.close);

  const activeTabId = useProjectStore((store) => store.activeProject?.id);

  const { onNewFile } = useFileOperations();

  const tabs = useProjectStore((store) => store.tabs);

  const handleTabClose = (tabId: string) => {
    close(tabs.findIndex(tab => tab.id === tabId));
  };

  const handleTabChange = (tabId: string) => {
    setActive(tabs.findIndex(tab => tab.id === tabId));
  };

  return (
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

        <TabBar
          tabs={tabs}
          activeTabId={activeTabId ?? undefined}
          onTabChange={handleTabChange}
          onTabClose={handleTabClose}
          onNewTab={onNewFile}
        />
      </div>

    </Tooltip.Provider>
  );
};