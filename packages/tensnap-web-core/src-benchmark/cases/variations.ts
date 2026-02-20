/**
 * cases/variations.ts
 *
 * Parameter variations for existing benchmark cases.
 * Each case has multiple configurations to test different performance scenarios.
 */

import { createLineChartCase } from './lineChart';
import { createParticleBounceCase } from './particleBounce';
import { createSpringGraphCase } from './springGraph';
import { BenchmarkCase } from '../types';

export interface CaseVariation {
  name: string;
  description: string;
  cases: BenchmarkCase[];
}

/**
 * Line Chart Variations
 * Tests different line counts and data point densities
 */
export const lineChartVariations: CaseVariation = {
  name: 'LineChart',
  description: 'Multi-line chart rendering with varying complexity',
  cases: [
    createLineChartCase({
      lineCount: 3,
      pointCount: 30,
      width: 600,
      height: 300,
    }),
    createLineChartCase({
      lineCount: 6,
      pointCount: 60,
      width: 600,
      height: 300,
    }),
    createLineChartCase({
      lineCount: 12,
      pointCount: 100,
      width: 600,
      height: 300,
    }),
    createLineChartCase({
      lineCount: 20,
      pointCount: 200,
      width: 800,
      height: 400,
    }),
  ],
};

/**
 * Particle Bounce Variations
 * Tests different particle counts and speeds
 */
export const particleBounceVariations: CaseVariation = {
  name: 'ParticleBounce',
  description: 'Free-flying particles with collision detection',
  cases: [
    createParticleBounceCase({
      particleCount: 100,
      width: 800,
      height: 500,
      maxSpeed: 3,
    }),
    createParticleBounceCase({
      particleCount: 200,
      width: 800,
      height: 500,
      maxSpeed: 4,
    }),
    createParticleBounceCase({
      particleCount: 500,
      width: 800,
      height: 500,
      maxSpeed: 5,
    }),
    createParticleBounceCase({
      particleCount: 1000,
      width: 1000,
      height: 600,
      maxSpeed: 6,
    }),
  ],
};

/**
 * Spring Graph Variations
 * Tests different graph sizes and densities
 */
export const springGraphVariations: CaseVariation = {
  name: 'SpringGraph',
  description: 'Force-directed graph layout with d3-force',
  cases: [
    createSpringGraphCase({
      nodeCount: 30,
      edgeProbability: 0.1,
      width: 800,
      height: 600,
      perturbFraction: 0.1,
    }),
    createSpringGraphCase({
      nodeCount: 60,
      edgeProbability: 0.08,
      width: 800,
      height: 600,
      perturbFraction: 0.1,
    }),
    createSpringGraphCase({
      nodeCount: 100,
      edgeProbability: 0.05,
      width: 1000,
      height: 700,
      perturbFraction: 0.08,
    }),
    createSpringGraphCase({
      nodeCount: 150,
      edgeProbability: 0.03,
      width: 1200,
      height: 800,
      perturbFraction: 0.05,
    }),
  ],
};

/**
 * Get all variations for testing
 */
export function getAllVariations(): CaseVariation[] {
  return [
    lineChartVariations,
    particleBounceVariations,
    springGraphVariations,
  ];
}
