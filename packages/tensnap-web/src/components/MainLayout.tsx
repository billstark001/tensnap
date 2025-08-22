import { useScenarioStore } from '../store/scenario';
import ViewRenderer from './view/ViewRenderer';
import { AnchoredViewRenderer } from './AnchoredViewRenderer';
import * as styles from '../styles/app.css';
import { ToolBarLayout } from './ToolBarLayout';
import { defaultSimulationState } from '@/types/modeling';
import { useButtonControls } from './useButtonControls';


export function MainLayout() {
  const {
    connected,
    currentTime,
    mainView,
    setMainView = (() => { }),
  } = useScenarioStore() ?? { ...defaultSimulationState(), mainView: undefined, updateMainViewLayout: undefined, setMainView: undefined };

  const { handleButtonAction } = useButtonControls();

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
          view={mainView}
          setView={setMainView}
          renderAnchoredView={AnchoredViewRenderer}
          onButtonAction={handleButtonAction}
        />}
      </main>
    </div>
  );
}