import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/ToolBarLayout';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';
import { ProjectPanel } from './components/project/ProjectPanel';


export function App() {
  
  const { loading: fileSystemLoading } = useFileSystem();
  const { loading: counterLoading } = useLoadingStore();

  return (
    <div className={styles.appContainer}>
      <ToolBarLayout />

      <ProjectPanel />

      {/* Loading Spinner Overlay */}
      {(fileSystemLoading || counterLoading) && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  );
}