import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/toolbar/ToolBarLayout';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';
import { ProjectPanel } from './components/project/ProjectPanel';
import { MenuBarConfig, MenuBarContext } from './components/toolbar/MenuBar';


export function App(props: Partial<MenuBarConfig>) {
  
  const { loading: fileSystemLoading } = useFileSystem();
  const { loading: counterLoading } = useLoadingStore();
  
  const {
    environment = 'web',
    system = 'other'
  } = props;

  return (
    <div className={styles.appContainer}>
      <MenuBarContext.Provider value={{ environment, system }}>
        <ToolBarLayout />
      </MenuBarContext.Provider>

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