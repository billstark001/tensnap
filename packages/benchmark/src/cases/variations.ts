/**
 * cases/variations.ts
 *
 * Parameter variations for all benchmark cases.
 *
 * Suite organisation:
 *   - synthetic: line chart, particle bounce, spring graph (renderer isolation tests)
 *   - web-scenario: Schelling, Wolf-Sheep (full model pipeline via @tensnap/js sessions)
 */

import { createLineChartCase } from './lineChart';
import { createParticleBounceCase } from './particleBounce';
import { createSpringGraphCase } from './springGraph';
import { schellingScenarioVariations } from './schellingScenario';
import { wolfSheepScenarioVariations } from './wolfSheepScenario';
import { CaseVariation } from '../types';

export type { CaseVariation };

/**
 * Line Chart Variations (synthetic)
 * Tests different line counts and data point densities.
 */
export const lineChartVariations: CaseVariation = {
  name: 'LineChart',
  description: 'Multi-line chart rendering with varying complexity',
  suite: 'synthetic',
  cases: [
    createLineChartCase({
      lineCount: 10,
      pointCount: 30,
      width: 600,
      height: 300,
    }),
    createLineChartCase({
      lineCount: 20,
      pointCount: 60,
      width: 600,
      height: 300,
    }),
    createLineChartCase({
      lineCount: 50,
      pointCount: 100,
      width: 600,
      height: 300,
    }),
    createLineChartCase({
      lineCount: 100,
      pointCount: 200,
      width: 800,
      height: 400,
    }),
  ],
};

/**
 * Particle Bounce Variations (synthetic)
 * Tests different particle counts and speeds.
 */
export const particleBounceVariations: CaseVariation = {
  name: 'ParticleBounce',
  description: 'Free-flying particles with collision detection',
  suite: 'synthetic',
  cases: [
    createParticleBounceCase({
      particleCount: 100,
      width: 80,
      height: 50,
      maxSpeed: 0.4,
    }),
    createParticleBounceCase({
      particleCount: 1000,
      width: 80,
      height: 50,
      maxSpeed: 0.5,
    }),
    createParticleBounceCase({
      particleCount: 10000,
      width: 80,
      height: 50,
      maxSpeed: 0.6,
    }),
    createParticleBounceCase({
      particleCount: 20000,
      width: 100,
      height: 60,
      maxSpeed: 0.6,
    }),
  ],
};

/**
 * Spring Graph Variations (synthetic)
 * Tests different graph sizes and densities.
 */
export const springGraphVariations: CaseVariation = {
  name: 'SpringGraph',
  description: 'Force-directed graph layout with d3-force',
  suite: 'synthetic',
  cases: [
    createSpringGraphCase({
      nodeCount: 50,
      edgeProbability: 0.2,
      width: 600,
      height: 600,
      perturbFraction: 0.1,
    }),
    createSpringGraphCase({
      nodeCount: 200,
      edgeProbability: 0.1,
      width: 600,
      height: 600,
      perturbFraction: 0.1,
    }),
    createSpringGraphCase({
      nodeCount: 500,
      edgeProbability: 0.08,
      width: 700,
      height: 700,
      perturbFraction: 0.08,
    }),
    createSpringGraphCase({
      nodeCount: 1000,
      edgeProbability: 0.03,
      width: 800,
      height: 800,
      perturbFraction: 0.05,
    }),
  ],
};

/**
 * Schelling Segregation Model Variations (web-scenario)
 * Uses the canonical @tensnap/js session instead of transport-based benchmark fixtures.
 */
export const schellingVariations: CaseVariation = {
  name: 'Schelling',
  description: 'Schelling segregation model via @tensnap/js session',
  suite: 'web-scenario',
  cases: schellingScenarioVariations,
};

/**
 * Wolf-Sheep Predation Model Variations (web-scenario)
 * Uses the canonical @tensnap/js session instead of transport-based benchmark fixtures.
 */
export const wolfSheepVariations: CaseVariation = {
  name: 'WolfSheep',
  description: 'Wolf-Sheep predation model via @tensnap/js session',
  suite: 'web-scenario',
  cases: wolfSheepScenarioVariations,
};

/**
 * Get all variations for testing.
 */
export function getAllVariations(): CaseVariation[] {
  return [
    lineChartVariations,
    particleBounceVariations,
    springGraphVariations,
    schellingVariations,
    wolfSheepVariations,
  ];
}