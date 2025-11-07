import Split from 'react-split';
import * as styles from './ProjectPanel.css';
import { MainViewRenderer } from './MainViewRenderer';
import { StatusBar } from './StatusBar';
import { ProjectTerminal } from './ProjectTerminal';
import { RightPanel } from './RightPanel';
import { useState, useCallback } from 'react';

export const ProjectPanel = () => {
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);

  const mainContent = <div className={styles.panelWrapper}>
    <MainViewRenderer />
  </div>;

  const rightPanelContent = <div
    className={styles.panelWrapper}
    style={{ display: rightPanelVisible ? 'flex' : 'none' }}
  >
    <RightPanel />
  </div>;

  const terminalContent = <div
    className={styles.panelWrapper}
    style={{ display: bottomPanelVisible ? 'flex' : 'none' }}
  >
    <ProjectTerminal />
  </div>;

  const horizontalSizes = rightPanelVisible ? [70, 30] : [100, 0];

  const horizontalSplit = <Split
    direction="horizontal"
    sizes={horizontalSizes}
    minSize={[0, 0]}
    gutterSize={rightPanelVisible ? 4 : 0}
    className="split-horizontal"
  >
    {mainContent}
    {rightPanelContent}
  </Split>;

  const verticalSizes = bottomPanelVisible ? [75, 25] : [100, 0];

  const verticalSplit = <Split
    direction="vertical"
    sizes={verticalSizes}
    minSize={[0, 0]}
    gutterSize={bottomPanelVisible ? 4 : 0}
    className="split-vertical"
  >
    {horizontalSplit}
    {terminalContent}
  </Split>;

  const toggleRightPanel = useCallback(() => {
    setRightPanelVisible(prev => !prev);
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelVisible(prev => !prev);
  }, []);

  return (
    <main className={styles.projectContainer}>
      <StatusBar
        onToggleRightPanel={toggleRightPanel}
        onToggleBottomPanel={toggleBottomPanel}
        rightPanelVisible={rightPanelVisible}
        bottomPanelVisible={bottomPanelVisible}
      />
      <div className={styles.mainContent}>
        {verticalSplit}
      </div>
    </main>
  );
};
