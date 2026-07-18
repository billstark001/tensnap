// Publication environment adapter over the production example WebSocket host.
import type { SchellingConfig } from '../../../../../examples/js/src/models/schelling';
import { startJsExampleWebSocketDemo } from '../../../../../examples/js/src/entries/main-ws';

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function configFromEnvironment(): SchellingConfig {
  return {
    gridWidth: numberEnv('TENSNAP_SCHELLING_WIDTH', 50),
    gridHeight: numberEnv('TENSNAP_SCHELLING_HEIGHT', 50),
    density: numberEnv('TENSNAP_SCHELLING_DENSITY', 0.8),
    balance: numberEnv('TENSNAP_SCHELLING_BALANCE', 0.5),
    similarityThreshold: numberEnv('TENSNAP_SCHELLING_THRESHOLD', 0.7),
    seed: numberEnv('TENSNAP_SCHELLING_SEED', 7),
  };
}

async function main(): Promise<void> {
  const demo = await startJsExampleWebSocketDemo('schelling', {
    port: numberEnv('TENSNAP_SERVER_PORT', 8765),
    encoding: 'json',
    config: configFromEnvironment(),
  });
  console.log(`Started ${demo.name} at ${demo.url ?? 'unknown url'}`);
}

void main();
