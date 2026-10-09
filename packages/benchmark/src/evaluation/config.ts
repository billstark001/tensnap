import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProfileWorkloads, validateProfile } from '../node/runner';
import type { BenchmarkProfile } from '../harness/types';
import { hashBytes, readJson } from './files';
import type { EvaluationSpecification, EvaluationMode } from './types';

export const defaultSpecification = 'benchmarks/evaluation/paper-2026.json';

export async function loadSpecification(
  root: string,
  file = defaultSpecification,
): Promise<EvaluationSpecification> {
  const specification = await readJson<EvaluationSpecification>(path.resolve(root, file));
  if (specification.schemaVersion !== 1 || !specification.experiments.length)
    throw new Error('Unsupported or empty evaluation specification.');
  const ids = new Set<string>();
  for (const experiment of specification.experiments) {
    if (!/^[a-z][a-z0-9-]*$/.test(experiment.id) || ids.has(experiment.id))
      throw new Error(`Invalid or duplicate experiment ID: ${experiment.id}`);
    ids.add(experiment.id);
    if (!['benchmark', 'conformance', 'workflow', 'fire'].includes(experiment.kind))
      throw new Error(`Unsupported experiment kind: ${experiment.kind}`);
    if ((experiment.kind === 'benchmark') !== Boolean(experiment.profile))
      throw new Error(`Only benchmark experiments declare a profile: ${experiment.id}`);
  }
  return specification;
}

export async function loadBenchmarkProfile(
  root: string,
  relative: string,
): Promise<BenchmarkProfile> {
  return validateProfile(await readJson(path.resolve(root, relative)));
}

/**
 * Smoke exercises the same condition matrix with one replicate and short action series.
 * Kernel conditions still measure their declared 500-step trajectory as one sample.
 */
export function diagnosticProfile(
  profile: BenchmarkProfile,
  profilePath: string,
): BenchmarkProfile {
  return validateProfile({
    ...profile,
    id: `${profile.id}-smoke`,
    description: `Diagnostic only. ${profile.description}`,
    requireCleanGit: false,
    repetitions: 1,
    warmupActions: Math.min(profile.warmupActions, 1),
    measuredActions: Math.min(profile.measuredActions, 2),
    workloads: profile.workloads.map((workload) => {
      const warmupActions = Math.min(workload.warmupActions ?? profile.warmupActions, 1);
      const measuredActions = Math.min(workload.measuredActions ?? profile.measuredActions, 2);
      return {
        ...workload,
        module: path.resolve(path.dirname(profilePath), workload.module),
        warmupActions,
        measuredActions,
        dimensions:
          workload.dimensions?.finalTick === undefined
            ? workload.dimensions
            : {
                ...workload.dimensions,
                finalTick: warmupActions + measuredActions,
                warmupActions,
                measuredActions,
              },
      };
    }),
  });
}

export async function describePlan(
  root: string,
  specification: EvaluationSpecification,
  mode: EvaluationMode,
): Promise<string> {
  const rows: string[] = [`${specification.id} (${mode})`];
  let total = 0;
  for (const experiment of specification.experiments) {
    if (!experiment.profile) {
      rows.push(`  ${experiment.id}: ${experiment.kind}`);
      continue;
    }
    const file = path.resolve(root, experiment.profile);
    const original = await loadBenchmarkProfile(root, experiment.profile);
    const profile = mode === 'smoke' ? diagnosticProfile(original, file) : original;
    const workloads = await loadProfileWorkloads(file, profile);
    let conditions = 0;
    for (const workload of workloads) {
      const suites = workload.workload.supportedSuites.filter((suite) =>
        profile.suites.includes(suite),
      );
      conditions +=
        suites.length *
        (workload.workload.kind === 'protocol'
          ? profile.encodings.length * profile.validation.length
          : 1);
    }
    const replicates = conditions * profile.repetitions;
    total += replicates;
    rows.push(
      `  ${experiment.id}: ${conditions} conditions × ${profile.repetitions} replicates = ${replicates}`,
    );
  }
  rows.push(`Benchmark replicates: ${total}; performance experiments run sequentially.`);
  return rows.join('\n');
}

export async function checkProfileLocks(
  root: string,
  specification: EvaluationSpecification,
): Promise<Record<string, string>> {
  const fingerprints: Record<string, string> = {};
  for (const experiment of specification.experiments) {
    if (!experiment.profile) continue;
    const file = path.resolve(root, experiment.profile);
    const profile = await loadBenchmarkProfile(root, experiment.profile);
    fingerprints[experiment.profile] = hashBytes(await readFile(file));
    for (const workload of profile.workloads) {
      const locks = workload.config?.environmentLocks as Record<string, string> | undefined;
      for (const [relative, expected] of Object.entries(locks ?? {})) {
        const actual = hashBytes(await readFile(path.resolve(root, relative)));
        if (actual !== expected)
          throw new Error(`Profile ${profile.id} has a stale environment lock: ${relative}`);
        fingerprints[relative] = actual;
      }
    }
    await loadProfileWorkloads(file, profile);
  }
  return fingerprints;
}
