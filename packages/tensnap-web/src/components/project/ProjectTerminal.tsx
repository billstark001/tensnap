
import { useScenarioStore } from '@/store/scenario';
import * as styles from './ProjectTerminal.css'
import { useEffect, useRef } from 'react';

export function ProjectTerminal() {
  const lastLogs = useScenarioStore((store) => store.lastLogs); // to trigger update
  const logs = useScenarioStore((store) => store.logs);

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lastLogs?.timestamp]);

  return <div className={styles.projectTerminal} ref={terminalRef}>
    {logs?.map((log, index) => (
      <div key={index} style={{ color: log.level === 'error' ? 'red' : log.level === 'warning' ? 'yellow' : 'white' }}>
        {log.target 
          ? `[${new Date(log.timestamp).toLocaleTimeString()} / ${log.level.toUpperCase()}][${log.target}] ${log.message}` 
          : `[${new Date(log.timestamp).toLocaleTimeString()} / ${log.level.toUpperCase()}] ${log.message}`}
      </div>
    ))}
  </div>;
}