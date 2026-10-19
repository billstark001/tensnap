import { createSplit } from '@tensnap/web-common/workbench/layout';
import { ContentIsland } from '@tensnap/web-common/workbench/portal-content';
import * as styles from './ProjectPanel.css';
import { MainViewRenderer } from './MainViewRenderer';
import { StatusBar } from './StatusBar';
import { ProjectTerminal } from './ProjectTerminal';
import { RightPanel } from './RightPanel';
import { useState, useCallback, useEffect, useLayoutEffect } from 'react';
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
    ])
      .then(([rightPanel, bottomPanel]) => {
        if (rightPanel != null) setRightPanelVisible(rightPanel === 'true');
        if (bottomPanel != null) setBottomPanelVisible(bottomPanel === 'true');
        setPanelStateLoaded(true);
      })
      .catch(() => setPanelStateLoaded(true));
  }, []);

  useEffect(() => {
    if (!panelStateLoaded) return;
    void getSettingsPersistence().set(RIGHT_PANEL_KEY, String(rightPanelVisible));
  }, [panelStateLoaded, rightPanelVisible]);

  useEffect(() => {
    if (!panelStateLoaded) return;
    void getSettingsPersistence().set(BOTTOM_PANEL_KEY, String(bottomPanelVisible));
  }, [bottomPanelVisible, panelStateLoaded]);

  const [panels] = useState(() => {
    const horizontal = createSplit('horizontal', 0.7);
    const vertical = createSplit('vertical', 0.75);
    vertical.first.append(horizontal.element);
    return { horizontal, vertical };
  });
  useLayoutEffect(() => {
    panels.horizontal.setVisible(rightPanelVisible);
  }, [panels, rightPanelVisible]);
  useLayoutEffect(() => {
    panels.vertical.setVisible(bottomPanelVisible);
  }, [panels, bottomPanelVisible]);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    host?.append(panels.vertical.element);
    return () => {
      panels.vertical.element.remove();
    };
  }, [host, panels]);

  const toggleRightPanel = useCallback(() => {
    setRightPanelVisible((prev) => !prev);
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelVisible((prev) => !prev);
  }, []);

  return (
    <main className={styles.projectContainer}>
      <StatusBar
        onToggleRightPanel={toggleRightPanel}
        onToggleBottomPanel={toggleBottomPanel}
        rightPanelVisible={rightPanelVisible}
        bottomPanelVisible={bottomPanelVisible}
      />
      <div className={styles.mainContent} ref={setHost} />
      <ContentIsland host={panels.horizontal.first}>
        <MainViewRenderer />
      </ContentIsland>
      <ContentIsland host={panels.horizontal.second} visible={rightPanelVisible}>
        <RightPanel />
      </ContentIsland>
      <ContentIsland host={panels.vertical.second} visible={bottomPanelVisible}>
        <ProjectTerminal />
      </ContentIsland>
    </main>
  );
};
