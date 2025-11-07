import { useScenarioStore } from './store/scenario';
import ViewRoot from './components/view/ViewRoot';
import { AnchoredViewRenderer } from './components/AnchoredViewRenderer';
import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/ToolBarLayout';
import { useButtonControls } from './components/useButtonControls';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';
import { createUpdateTriggerStore } from './store/update-trigger';
import { Trans } from '@lingui/react/macro';

function StatusBar() {
  const connected = useScenarioStore((store) => store.connected);
  const currentTime = useScenarioStore((store) => store.currentTime);

  return (
    <div className={styles.statusBar}>
      <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
        {connected ? <Trans>Connected</Trans> : <Trans>Disconnected</Trans>}
      </span>
      <span style={{ marginLeft: '16px' }}><Trans>Time Step:</Trans> {currentTime}</span>
    </div>
  )
}

const useUpdateTriggerStore = createUpdateTriggerStore();

function MainViewWrapper() {
  const mainView = useScenarioStore((store) => store.mainView);

  const updateTrigger = useUpdateTriggerStore((store) => store.updateTrigger);
  const onUpdate = useUpdateTriggerStore((store) => store.onUpdate);

  const { handleButtonAction } = useButtonControls();

  if (!mainView) {
    return null;
  }

  return (
    <ViewRoot
      view={mainView}
      updateTrigger={updateTrigger}
      onViewUpdate={onUpdate}
      renderAnchoredView={AnchoredViewRenderer}
      onButtonAction={handleButtonAction}
    />
  );
}

export function App() {
  
  const { loading: fileSystemLoading } = useFileSystem();
  const { loading: counterLoading } = useLoadingStore();

  return (
    <div className={styles.container}>
      <ToolBarLayout />

      <main className={styles.main} style={{ padding: 0, overflow: 'hidden' }}>
        <StatusBar />
        <MainViewWrapper />
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