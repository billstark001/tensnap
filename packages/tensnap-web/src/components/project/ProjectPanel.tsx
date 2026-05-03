import Split from 'react-split';
import * as styles from './ProjectPanel.css';
import { MainViewRenderer } from './MainViewRenderer';
import { StatusBar } from './StatusBar';
import { ProjectTerminal } from './ProjectTerminal';
import { RightPanel } from './RightPanel';
import { useState, useCallback, useEffect } from 'react';

const RIGHT_PANEL_KEY = 'tensnap:panel:right';
const BOTTOM_PANEL_KEY = 'tensnap:panel:bottom';

const readPanelState = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (raw == null) {
    return fallback;
  }
  return raw === 'true';
};

export const ProjectPanel = () => {
  const [rightPanelVisible, setRightPanelVisible] = useState(() => readPanelState(RIGHT_PANEL_KEY, true));
  const [bottomPanelVisible, setBottomPanelVisible] = useState(() => readPanelState(BOTTOM_PANEL_KEY, true));

  useEffect(() => {
    window.localStorage.setItem(RIGHT_PANEL_KEY, String(rightPanelVisible));
  }, [rightPanelVisible]);

  useEffect(() => {
    window.localStorage.setItem(BOTTOM_PANEL_KEY, String(bottomPanelVisible));
  }, [bottomPanelVisible]);

  const mainContent = <div className={styles.panelWrapper}>
    <MainViewRenderer />
  </div>;

  const rightPanelContent = <div
    className={styles.panelWrapper}
    style={{ display: rightPanelVisible ? 'flex' : 'none' }}
  >
    { rightPanelVisible ? <RightPanel /> : null }
  </div>;

  const terminalContent = <div
    className={styles.panelWrapper}
    style={{ display: bottomPanelVisible ? 'flex' : 'none' }}
  >
    { bottomPanelVisible ? <ProjectTerminal /> : null }
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
