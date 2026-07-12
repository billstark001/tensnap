import Split from 'react-split';
import * as styles from './ProjectPanel.css';
import { MainViewRenderer } from './MainViewRenderer';
import { StatusBar } from './StatusBar';
import { ProjectTerminal } from './ProjectTerminal';
import { RightPanel } from './RightPanel';
import { useState, useCallback, useEffect } from 'react';
import { getSettingsPersistence } from '@/store/settings-persistence';

const RIGHT_PANEL_KEY = 'tensnap:panel:right';
const BOTTOM_PANEL_KEY = 'tensnap:panel:bottom';

export const ProjectPanel = () => {
  const [rightPanelVisible, setRightPanelVisible] = useState(true);
  const [bottomPanelVisible, setBottomPanelVisible] = useState(true);
  const [panelStateLoaded, setPanelStateLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([
      getSettingsPersistence().get(RIGHT_PANEL_KEY),
      getSettingsPersistence().get(BOTTOM_PANEL_KEY),
    ]).then(([rightPanel, bottomPanel]) => {
      if (rightPanel != null) setRightPanelVisible(rightPanel === 'true');
      if (bottomPanel != null) setBottomPanelVisible(bottomPanel === 'true');
      setPanelStateLoaded(true);
    }).catch(() => setPanelStateLoaded(true));
  }, []);

  useEffect(() => {
    if (!panelStateLoaded) return;
    void getSettingsPersistence().set(RIGHT_PANEL_KEY, String(rightPanelVisible));
  }, [panelStateLoaded, rightPanelVisible]);

  useEffect(() => {
    if (!panelStateLoaded) return;
    void getSettingsPersistence().set(BOTTOM_PANEL_KEY, String(bottomPanelVisible));
  }, [bottomPanelVisible, panelStateLoaded]);

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
