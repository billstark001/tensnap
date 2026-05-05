/**
 * cases/wolfSheepScenario.ts
 *
 * Wolf-Sheep Predation Model benchmark case (web-scenario).
 *
 * Delegates to the shared createWebScenarioCase factory so that lifecycle
 * management (Scenario, EnvironmentRendererController, chart views, asset
 * resolution, session open/state_sync/tick/teardown) stays in one place.
 *
 * IMPORTANT: Unlike the standalone shema/schelling example, Wolf-Sheep
 * agents use `asset:<id>` icons (SVG).  The shared factory injects the
 * `resolveAssetUrl` callback which delegates to Scenario.assets.getUrl,
 * fixing the prior issue where wolf-sheep animals were invisible in
 * benchmark due to missing asset resolution (see
 * layer-registry-event-loop-audit-2026-05-06.md §5).
 */

import { WOLF_SHEEP_EXAMPLE } from '@tensnap/examples-js';
import type { WolfSheepConfig } from '@tensnap/examples-js/models';
import { createWebScenarioCase, type WebScenarioHooks } from './createWebScenarioCase';
import type { BenchmarkCase } from '../types';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const WOLF_SHEEP_HOOKS: WebScenarioHooks = {
  name: 'Wolf-Sheep Predation Model (web-scenario)',

  createSession: (modelConfig) => WOLF_SHEEP_EXAMPLE.createSession(modelConfig as unknown as WolfSheepConfig),

  buildModelConfig(partial) {
    return {
      modelVersion: (partial.modelVersion as WolfSheepConfig['modelVersion']) ?? 'sheep-wolves-grass',
      initialNumberSheep: (partial.initialNumberSheep as number) ?? 100,
      initialNumberWolves: (partial.initialNumberWolves as number) ?? 50,
      sheepGainFromFood: (partial.sheepGainFromFood as number) ?? 4,
      wolfGainFromFood: (partial.wolfGainFromFood as number) ?? 20,
      grassRegrowthTime: (partial.grassRegrowthTime as number) ?? 30,
      sheepReproduce: (partial.sheepReproduce as number) ?? 4,
      wolfReproduce: (partial.wolfReproduce as number) ?? 5,
      showEnergy: (partial.showEnergy as boolean) ?? false,
      gridWidth: (partial.gridWidth as number) ?? 50,
      gridHeight: (partial.gridHeight as number) ?? 50,
    };
  },

  buildLayoutConfig(partial, modelConfig) {
    return {
      ...modelConfig,
      envBackground: '#D2B48C',
      envWidth: (partial.envWidth as number) ?? 700,
      envHeight: (partial.envHeight as number) ?? 700,
      chartWidth: (partial.chartWidth as number) ?? 700,
      chartHeight: (partial.chartHeight as number) ?? 200,
    };
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createWolfSheepScenarioCase(partial: Record<string, unknown> = {}): BenchmarkCase {
  return createWebScenarioCase(partial, WOLF_SHEEP_HOOKS);
}

export const wolfSheepScenarioVariations = [
  createWolfSheepScenarioCase({
    gridWidth: 30,
    gridHeight: 30,
    initialNumberSheep: 50,
    initialNumberWolves: 25,
    sheepGainFromFood: 4,
    wolfGainFromFood: 20,
    grassRegrowthTime: 30,
    envWidth: 500,
    envHeight: 500,
  }),
  createWolfSheepScenarioCase({
    gridWidth: 50,
    gridHeight: 50,
    initialNumberSheep: 400,
    initialNumberWolves: 150,
    sheepGainFromFood: 4,
    wolfGainFromFood: 20,
    grassRegrowthTime: 30,
    envWidth: 700,
    envHeight: 700,
  }),
  createWolfSheepScenarioCase({
    gridWidth: 100,
    gridHeight: 100,
    initialNumberSheep: 800,
    initialNumberWolves: 400,
    sheepGainFromFood: 4,
    wolfGainFromFood: 20,
    grassRegrowthTime: 25,
    envWidth: 900,
    envHeight: 900,
  }),
];
