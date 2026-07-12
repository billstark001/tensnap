import type { BenchmarkCase, CaseGroup } from '../types';
import { axelrodScenarioVariations } from './axelrodScenario';
import { createGridAgentsCase } from './gridAgents';
import { createLineChartCase } from './lineChart';
import { createParticleBounceCase } from './particleBounce';
import { createRandomWalkCases } from './randomWalk';
import { schellingScenarioVariations } from './schellingScenario';
import { createSpringGraphCase } from './springGraph';
import { createTrajectoryCase } from './trajectory';
import { createUniformAgentsCase } from './uniformAgents';
import { wolfSheepScenarioVariations } from './wolfSheepScenario';

const componentCases: BenchmarkCase[] = [
  createLineChartCase(),
  createParticleBounceCase(),
  createSpringGraphCase(),
  createGridAgentsCase(),
  createTrajectoryCase(),
  createUniformAgentsCase(),
];

const modelVariations = [
  axelrodScenarioVariations,
  schellingScenarioVariations,
  wolfSheepScenarioVariations,
];

export function getCaseGroups(allModelVariations = false): CaseGroup[] {
  const modelCases = allModelVariations
    ? modelVariations.flat()
    : modelVariations.map((cases) => cases[Math.min(1, cases.length - 1)]);
  return [
    {
      name: 'Components', category: 'component',
      description: 'Production Web chart/environment components with direct local state updates and no transport.',
      cases: componentCases,
    },
    {
      name: 'Models', category: 'model',
      description: 'Complete bundled models through transport, RendererSession, Zustand, React and canvas rendering.',
      cases: modelCases,
    },
    {
      name: 'Random walk', category: 'random-walk',
      description: 'The same workload through raw Leafer, core layers without transport, and the full Web transport path.',
      cases: createRandomWalkCases(),
    },
  ];
}
