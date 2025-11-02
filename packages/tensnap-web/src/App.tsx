import { useScenarioStore } from './store/scenario';
import ViewRenderer from './components/view/ViewRenderer';
import { AnchoredViewRenderer } from './components/AnchoredViewRenderer';
import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/ToolBarLayout';
import { useButtonControls } from './components/useButtonControls';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';

function StatusBar() {
  const connected = useScenarioStore((store) => store.connected);
  const currentTime = useScenarioStore((store) => store.currentTime);

  return (
    <div className={styles.statusBar}>
      <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
      <span style={{ marginLeft: '16px' }}>Time Step: {currentTime}</span>
    </div>
  )
}

export function App() {
  const mainView = useScenarioStore((store) => store.mainView);
  const setMainView = useScenarioStore((store) => store.setMainView);
  
  const { loading: fileSystemLoading } = useFileSystem();
  const { loading: counterLoading } = useLoadingStore();

  const { handleButtonAction } = useButtonControls();

  return (
    <div className={styles.container}>
      <ToolBarLayout />

      <main className={styles.main} style={{ padding: 0, overflow: 'hidden' }}>
        <StatusBar />
        {mainView && <ViewRenderer
          view={mainView}
          setView={setMainView!}
          renderAnchoredView={AnchoredViewRenderer}
          onButtonAction={handleButtonAction}
        />}
      </main>

      {/* Loading Spinner Overlay */}
      {(fileSystemLoading || counterLoading) && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  );
}