
import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './ProjectTerminal.css'
import { useEffect, useRef } from 'react';

export function ProjectTerminal() {
  const logRevision = useScenarioStore((store) => store.logRevision);
  const logs = useScenarioStore((store) => store.logs);

  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logRevision]);

  const getLogClassName = (level: string) => {
    switch (level) {
      case 'error':
        return styles.terminalLogError;
      case 'warning':
        return styles.terminalLogWarning;
      default:
        return styles.terminalLogInfo;
    }
  };

  return <div className={styles.projectTerminal} ref={terminalRef}>
    {logs?.map((log, index) => (
      <div key={index} className={getLogClassName(log.level)}>
        {log.target 
          ? `[${new Date(log.timestamp).toLocaleTimeString()} / ${log.level.toUpperCase()}][${log.target}] ${log.message}` 
          : `[${new Date(log.timestamp).toLocaleTimeString()} / ${log.level.toUpperCase()}] ${log.message}`}
      </div>
    ))}
  </div>;
}
