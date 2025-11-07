import Split from 'react-split';
import * as styles from './ProjectPanel.css';
import { MainViewWrapper } from './MainViewRenderer';
import { StatusBar } from './StatusBar';
import { ProjectTerminal } from './ProjectTerminal';
import { useState } from 'react';

export const ProjectPanel = () => {

  const [rightExpanded, setRightExpanded] = useState(false);
  const [bottomExpanded, setBottomExpanded] = useState(false);

  const mainView = <MainViewWrapper />;
  const terminal = <ProjectTerminal />;

  const topPanel = rightExpanded ? <Split
    direction="horizontal"
    sizes={[500, 200]}
    minSize={200}
    gutterSize={4}
    className="split-horizontal"
  >
    {mainView}
    <div style={{ display: bottomExpanded ? 'block' : 'none' }}>
      {terminal}
    </div>
  </Split> : mainView;

  const mainPanel = bottomExpanded ? <Split
    direction="vertical"
    sizes={[750, 250]}
    minSize={100}
    gutterSize={4}
    className="split-vertical"
  >
    {topPanel}
    {terminal}
  </Split> : topPanel;

  return (
    <main className={styles.projectContainer}>
      <StatusBar />
      {mainPanel}
    </main>
  );
};
