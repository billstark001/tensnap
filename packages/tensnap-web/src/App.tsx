import { useScenarioStore } from './store/scenario';
import ViewRenderer from './components/view/ViewRenderer';
import { AnchoredViewRenderer } from './components/AnchoredViewRenderer';
import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/ToolBarLayout';
import { useButtonControls } from './components/useButtonControls';
import { useFileSystem } from './store/file-system/provider';


export function App() {
  const {
    connected = false,
    currentTime = 0,
    mainView,
    setMainView,
  } = useScenarioStore() ?? {};
  
  const { loading } = useFileSystem();

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
          setView={setMainView!}
          renderAnchoredView={AnchoredViewRenderer}
          onButtonAction={handleButtonAction}
        />}
      </main>

      {/* Loading Spinner Overlay */}
      {loading && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  );
}