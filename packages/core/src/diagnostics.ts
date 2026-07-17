/** Host-neutral diagnostic event emitted by protocol/runtime boundaries. */
export type DiagnosticSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical';

export interface DiagnosticEvent {
  timestamp: number;
  severity: DiagnosticSeverity;
  /** Broad subsystem used for filtering and routing. */
  domain: 'protocol' | 'transport' | 'runtime' | 'simulator' | 'storage' | 'ui';
  /** Originating runtime or adapter name, never a presentation component. */
  source: string;
  code?: string;
  message: string;
  requestId?: string;
  target?: string;
  details?: unknown;
  dedupeKey?: string;
}
