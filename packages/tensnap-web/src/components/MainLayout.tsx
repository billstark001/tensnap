import { useEffect } from 'react';
import { useScenarioStore } from '../store/scenario';
import { useTheme } from '../contexts/ThemeContext';
import ViewRenderer from './view/ViewRenderer';
import { AnchoredViewRenderer } from './AnchoredViewRenderer';
import * as styles from '../styles/app.css';

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

  const { theme, toggleTheme } = useTheme();

  // Update layout when data changes
  useEffect(() => {
    updateMainViewLayout();
  }, [environments, parameters, charts, updateMainViewLayout]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1>TenSnap Visualization</h1>
          <span className={connected ? styles.statusConnected : styles.statusDisconnected}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
          <span style={{ marginLeft: '16px' }}>Time Step: {currentTime}</span>
        </div>
        <button
          onClick={toggleTheme}
          className={styles.button}
          aria-label="Toggle theme"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </header>

      <main className={styles.main} style={{ padding: 0, overflow: 'hidden' }}>
        <ViewRenderer
          key={`${environments.length}-${parameters.length}-${charts.length}`}
          initialView={mainView}
          renderAnchoredView={AnchoredViewRenderer}
        />
      </main>
    </div>
  );
}