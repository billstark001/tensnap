import { useEffect } from 'react';
import { useScenarioStore } from '../store/scenario';
import ViewRenderer from './view/ViewRenderer';
import { AnchoredViewRenderer } from './AnchoredViewRenderer';
import * as styles from '../styles/app.css';
import { ToolBarLayout } from './ToolBarLayout';
import { defaultSimulationState } from '@/types/modeling';


export function MainLayout() {
  const {
    connected,
    currentTime,
    mainView,
    environments,
    parameters,
    charts,
    updateMainViewLayout = (() => { })
  } = useScenarioStore() ?? { ...defaultSimulationState(), mainView: undefined, updateMainViewLayout: undefined };

  // Update layout when data changes
  useEffect(() => {
    updateMainViewLayout();
  }, [environments, parameters, charts, updateMainViewLayout]);

  return (
    <div className={styles.container}>
      <ToolBarLayout />

      <main className={styles.main} style={{ padding: 0, overflow: 'hidden' }}>
        <div>
          <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <span style={{ marginLeft: '16px' }}>Time Step: {currentTime}</span>
        </div>
        {mainView && <ViewRenderer
          key={`${environments.length}-${parameters.length}-${charts.length}`}
          initialView={mainView}
          renderAnchoredView={AnchoredViewRenderer}
        />}
      </main>
    </div>
  );
}