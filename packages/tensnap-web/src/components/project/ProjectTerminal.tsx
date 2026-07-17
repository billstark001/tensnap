import type { DiagnosticSeverity } from '@tensnap/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './ProjectTerminal.css';
import { ProjectDiagnostic } from '@/store/scenario/types';

type DiagnosticFilter = 'all' | DiagnosticSeverity;

const formatDetails = (details: unknown): string => {
  if (details instanceof Error) return details.stack ?? details.message;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
};

const EMPTY_DIAGNOSTICS: readonly ProjectDiagnostic[] = [];

export function ProjectTerminal() {
  const diagnosticRevision = useScenarioStore((store) => store.diagnosticRevision);
  const diagnostics = useScenarioStore((store) => store.diagnostics) ?? EMPTY_DIAGNOSTICS;
  const clearDiagnostics = useScenarioStore((store) => store.clearDiagnostics) ?? (() => undefined);
  const [filter, setFilter] = useState<DiagnosticFilter>('all');
  const [follow, setFollow] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const visibleDiagnostics = useMemo(() => (
    filter === 'all' ? diagnostics : diagnostics.filter((diagnostic) => diagnostic.severity === filter)
  ), [diagnostics, filter]);

  useEffect(() => {
    if (follow && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [diagnosticRevision, follow]);

  return (
    <section className={styles.projectContainer} aria-label="Diagnostics">
      <header className={styles.terminalToolbar}>
        <strong>Diagnostics</strong>
        <span className={styles.terminalCount}>{visibleDiagnostics.length}/{diagnostics.length}</span>
        <label className={styles.terminalControl}>
          Level
          <select value={filter} onChange={(event) => setFilter(event.target.value as DiagnosticFilter)}>
            <option value="all">All</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </label>
        <label className={styles.terminalControl}>
          <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          Follow
        </label>
        <button type="button" className={styles.clearButton} onClick={clearDiagnostics} disabled={diagnostics.length === 0}>
          Clear
        </button>
      </header>
      <div className={styles.projectTerminal} ref={terminalRef} aria-live="polite">
        {visibleDiagnostics.map((diagnostic) => (
          <article key={diagnostic.id} className={getDiagnosticClassName(diagnostic.severity)}>
            <div>
              [{new Date(diagnostic.timestamp).toLocaleTimeString()} / {diagnostic.severity.toUpperCase()}]
              [{diagnostic.source}{diagnostic.code ? `/${diagnostic.code}` : ''}{diagnostic.target ? `/${diagnostic.target}` : ''}]
              {' '}{diagnostic.message}{diagnostic.count > 1 ? ` ×${diagnostic.count}` : ''}
            </div>
            {diagnostic.details === undefined ? null : (
              <details className={styles.terminalDetails}>
                <summary>Details</summary>
                <pre>{formatDetails(diagnostic.details)}</pre>
              </details>
            )}
          </article>
        ))}
        {visibleDiagnostics.length === 0 ? <p className={styles.emptyTerminal}>No diagnostics.</p> : null}
      </div>
    </section>
  );
}

function getDiagnosticClassName(severity: DiagnosticSeverity): string {
  switch (severity) {
    case 'critical':
    case 'error':
      return styles.terminalLogError;
    case 'warning':
      return styles.terminalLogWarning;
    default:
      return styles.terminalLogInfo;
  }
}
