import path from 'node:path';
import type { ExternalBrowserBenchmarkWorkload } from '@tensnap/benchmark/harness';
import { browserWorkload, resolveTenSnapWebConfig, type TenSnapWebConfig } from './tensnap-web';
import { validateSchellingObservation } from './oracle';

function interpolate(value: string, config: TenSnapWebConfig, root: string, replicate: number, port: number): string {
  return value
    .split('{repositoryRoot}').join(root)
    .split('{seed}').join(String(config.seed + replicate))
    .split('{replicate}').join(String(replicate))
    .split('{port}').join(String(port));
}

export const workload: ExternalBrowserBenchmarkWorkload<TenSnapWebConfig> = {
  schemaVersion: 2,
  id: 'system.schelling.tensnap-web',
  version: 1,
  kind: 'external-browser',
  category: 'system',
  description: 'A production TenSnap Web host connected to a process-owned Schelling simulator.',
  supportedSuites: ['browser'],
  resolveConfig: resolveTenSnapWebConfig,
  createExternalBrowserSpec(config, context) {
    const expand = (value: string) => interpolate(value, config, context.repositoryRoot, context.replicate, context.port);
    return {
      server: {
        executable: expand(config.executable), args: config.args.map(expand),
        cwd: config.cwd ? path.resolve(context.repositoryRoot, expand(config.cwd)) : context.repositoryRoot,
        env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, expand(value)])),
        timeoutMs: config.timeoutMs,
      },
      ...(config.environmentLocks ? { environmentLocks: config.environmentLocks } : {}),
      url: 'about:blank', readySelector: 'body', action: { selector: 'body' },
      tensnapHarness: {
        workloadId: browserWorkload.id,
        config: { ...config, endpoint: expand(config.endpoint) },
        endpoint: expand(config.endpoint), encoding: config.encoding ?? 'json', validation: 'error',
      },
    };
  },
  validateExternalBrowserObservation: validateSchellingObservation,
};

export default workload;
