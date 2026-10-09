/** A paper batch combines existing experiment runners without changing their timing intervals. */
export type ExperimentKind = 'benchmark' | 'conformance' | 'workflow' | 'fire';
export type EvaluationMode = 'publication' | 'smoke';

export interface Experiment {
  id: string;
  kind: ExperimentKind;
  profile?: string;
}

export interface EvaluationSpecification {
  schemaVersion: 1;
  id: string;
  experiments: Experiment[];
}

export interface ExperimentProgress {
  status: 'pending' | 'running' | 'complete' | 'failed';
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface EvaluationBatch {
  schemaVersion: 1;
  mode: EvaluationMode;
  specification: EvaluationSpecification;
  specificationSha256: string;
  source: { commit: string; dirty: boolean; filesSha256: string };
  environment: Record<string, unknown>;
  createdAt: string;
  status: 'running' | 'failed' | 'complete';
  experiments: Record<string, ExperimentProgress>;
}

export interface ExecutionContext {
  repositoryRoot: string;
  python: string;
  workDirectory: string;
  cacheDirectory: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ExecutionDirectories {
  workDirectory?: string;
  cacheDirectory?: string;
}

export interface ExportOptions {
  /** Gzip levels 0 through 9; the default is 6. */
  gzipLevel?: number;
}

export interface ExportIndex {
  schemaVersion: 1 | 2;
  filesSha256: Record<string, string>;
  archives?: { data: 'data.tar.gz'; figures: 'figures.tar.gz' };
  compression?: { algorithm: 'gzip'; level: number };
}
