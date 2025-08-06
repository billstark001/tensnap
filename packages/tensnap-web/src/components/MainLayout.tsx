import React from 'react';
import { useScenarioStore } from '../store/scenario';
import { useTheme } from '../contexts/ThemeContext';
import { GridEnvironmentView } from './GridEnvironment';
import { GraphEnvironmentView } from './GraphEnvironment';
import { ParameterControls } from './ParameterControls';
import { ChartView } from './ChartView';
import * as styles from '../styles/app.css';

export function MainLayout() {
  const { 
    connected, 
    currentTime, 
    environments, 
    parameters, 
    charts 
  } = useScenarioStore();
  
  const { theme, toggleTheme } = useTheme();
  
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
      
      <main className={styles.main}>
        <aside className={styles.sidebar}>
          <h3>Parameters</h3>
          <ParameterControls parameters={parameters} />
        </aside>
        
        <div className={styles.content}>
          <section>
            <h3>Environments</h3>
            <div className={styles.environmentGrid}>
              {environments.map((env) => (
                <div key={env.id.toString()} className={styles.environmentCard}>
                  <h4>Environment: {env.id}</h4>
                  {env.type === 'grid' ? (
                    <GridEnvironmentView environment={env} />
                  ) : (
                    <GraphEnvironmentView environment={env} />
                  )}
                </div>
              ))}
            </div>
          </section>
          
          {charts.length > 0 && (
            <section>
              <h3>Data Visualization</h3>
              <ChartView charts={charts} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}