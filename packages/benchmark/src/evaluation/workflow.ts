import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashBytes, readJson } from './files';

export const workflowHosts = ['python', 'go', 'js', 'julia'] as const;
export interface TrajectoryPoint {
  time: number;
  stateHash: string;
  agentsHash: string;
  metrics: Record<string, number>;
  threshold: number;
}
export interface WorkflowReport {
  host: string;
  revision: string;
  sourceDigest: string;
  setup: {
    gridWidth: number;
    gridHeight: number;
    seed: number;
    protocolEncoding: string;
    validation: string;
  };
  boundedRun: { completedSteps: number };
  checkpoint: { modelId: string; schema: string; sha256: string };
  exactRestore: { captured: string; restored: string; pass: boolean };
  deterministicFuture: { future: TrajectoryPoint[]; replay: TrajectoryPoint[]; pass: boolean };
  branches: { threshold: number; trajectory: TrajectoryPoint[] }[];
  rendering: { width: number; height: number; sha256: string };
}

function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function checkTrajectory(points: TrajectoryPoint[], length: number, threshold?: number): void {
  requireEvidence(points.length === length, 'Incomplete workflow trajectory.');
  points.forEach((point, index) => {
    requireEvidence(point.time === index + 6, 'Workflow trajectory time mismatch.');
    requireEvidence(
      /^[0-9a-f]{64}$/.test(point.stateHash) && /^[0-9a-f]{64}$/.test(point.agentsHash),
      'Missing state or spatial digest.',
    );
    if (threshold !== undefined)
      requireEvidence(point.threshold === threshold, 'Branch threshold mismatch.');
  });
}

/** Offline checks of the independently audited comparisons and the actual retained file bytes. */
export async function verifyWorkflow(directory: string): Promise<void> {
  const summary = await readJson<{
    revision: string;
    sourceDigest: string;
    sourceHashes: Record<string, string>;
    hosts: { host: string; pass: boolean; report: string }[];
  }>(path.join(directory, 'summary.json'));
  requireEvidence(summary.hosts.length === workflowHosts.length, 'Incomplete four-host workflow.');
  requireEvidence(
    new Set(summary.hosts.map((host) => host.host)).size === workflowHosts.length,
    'Duplicate workflow host.',
  );
  requireEvidence(
    hashBytes(JSON.stringify(summary.sourceHashes)) === summary.sourceDigest,
    'Workflow source inventory mismatch.',
  );
  for (const host of workflowHosts) {
    requireEvidence(
      summary.hosts.some((entry) => entry.host === host && entry.pass),
      `Workflow failed: ${host}`,
    );
    const folder = path.join(directory, host);
    const report = await readJson<WorkflowReport>(path.join(folder, 'report.json'));
    requireEvidence(
      report.host === host &&
        report.revision === summary.revision &&
        report.sourceDigest === summary.sourceDigest,
      'Workflow provenance mismatch.',
    );
    requireEvidence(
      report.setup.gridWidth === 16 && report.setup.gridHeight === 12 && report.setup.seed === 7,
      'Unexpected workflow inputs.',
    );
    requireEvidence(
      report.setup.protocolEncoding === 'json' && report.setup.validation === 'error',
      'Unexpected workflow transport.',
    );
    requireEvidence(report.boundedRun.completedSteps === 5, 'Incomplete bounded run.');
    requireEvidence(
      report.exactRestore.pass && report.exactRestore.captured === report.exactRestore.restored,
      'Captured and restored audit hashes differ.',
    );
    checkTrajectory(report.deterministicFuture.future, 3);
    checkTrajectory(report.deterministicFuture.replay, 3);
    requireEvidence(
      report.deterministicFuture.pass &&
        JSON.stringify(report.deterministicFuture.future) ===
          JSON.stringify(report.deterministicFuture.replay),
      'Rerun differs from the saved future.',
    );
    requireEvidence(report.branches.length === 2, 'Missing parameter branch.');
    for (const [index, threshold] of [0.55, 0.8].entries()) {
      const branch = report.branches[index]!;
      requireEvidence(branch.threshold === threshold, 'Unexpected branch parameter.');
      checkTrajectory(branch.trajectory, 6, threshold);
    }
    requireEvidence(
      report.branches[0]!.trajectory.some(
        (point, index) => point.agentsHash !== report.branches[1]!.trajectory[index]!.agentsHash,
      ),
      'Parameter branches have identical spatial trajectories.',
    );
    const checkpointBytes = await readFile(path.join(folder, 'checkpoint.json'));
    requireEvidence(
      hashBytes(checkpointBytes) === report.checkpoint.sha256,
      'Retained checkpoint bytes differ from their recorded hash.',
    );
    const checkpoint = JSON.parse(checkpointBytes.toString()) as {
      model_id: string;
      state_schema_version: string;
    };
    requireEvidence(
      checkpoint.model_id === report.checkpoint.modelId &&
        checkpoint.state_schema_version === report.checkpoint.schema,
      'Checkpoint identity mismatch.',
    );
    const png = await readFile(path.join(folder, 'scene.png'));
    requireEvidence(
      png.length >= 24 && png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      'Invalid retained PNG.',
    );
    requireEvidence(
      png.readUInt32BE(16) === report.rendering.width &&
        png.readUInt32BE(20) === report.rendering.height &&
        hashBytes(png) === report.rendering.sha256,
      'Rendered PNG dimensions or checksum mismatch.',
    );
  }
}
