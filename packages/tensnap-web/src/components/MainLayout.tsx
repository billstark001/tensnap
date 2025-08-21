import { PropsWithChildren, useEffect } from 'react';
import { useScenarioStore } from '../store/scenario';
import ViewRenderer from './view/ViewRenderer';
import { AnchoredViewRenderer } from './AnchoredViewRenderer';
import * as styles from '../styles/app.css';
import { ToolBarLayout } from './ToolBarLayout';
import { AdapterProvider } from '@/store/file-system/provider';


function Providers({ children }: PropsWithChildren<object>) {
  return <AdapterProvider preferredAdapter="indexeddb">
    {children}
  </AdapterProvider>
}


export function MainLayout() {
  const {
    connected,
    currentTime,
    mainView,
    environments,
    parameters,
    charts,
    updateMainViewLayout
  } = useScenarioStore();

  // Update layout when data changes
  useEffect(() => {
    updateMainViewLayout();
  }, [environments, parameters, charts, updateMainViewLayout]);

  return (
    <Providers>
      <div className={styles.container}>
        <ToolBarLayout />

        <main className={styles.main} style={{ padding: 0, overflow: 'hidden' }}>
          <div>
            <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            <span style={{ marginLeft: '16px' }}>Time Step: {currentTime}</span>
          </div>
          <ViewRenderer
            key={`${environments.length}-${parameters.length}-${charts.length}`}
            initialView={mainView}
            renderAnchoredView={AnchoredViewRenderer}
          />
        </main>
      </div>
    </Providers>
  );
}