// Publication audit sidecar; not part of the teaching Schelling example.
// Loaded only by the Node WebSocket launcher when explicitly requested.
import type { SchellingConfig, SchellingModel } from '../models/schelling';

interface LiveInternals {
  config: SchellingConfig;
  seed?: number;
  rngState: number;
  timeStep: number;
  agents: Array<{ id: string; x: number; y: number; type: number; satisfied: boolean }>;
  emptySpots: number[];
  unsatisfiedSet: Set<{ id: string }>;
  lastMoved: number;
}

export function schellingAuditState(model: SchellingModel) {
  // Intentional read of private runtime fields, independent of checkpoint capture.
  const live = model as unknown as LiveInternals;
  return {
    time: live.timeStep,
    config: { ...live.config, seed: live.seed ?? null },
    agents: live.agents.map((agent) => ({
      id: agent.id, x: agent.x, y: agent.y, group: agent.type, satisfied: agent.satisfied,
    })),
    rngState: live.rngState,
    emptySpots: [...live.emptySpots],
    unsatisfiedIds: [...live.unsatisfiedSet].map((agent) => agent.id),
    lastMoved: live.lastMoved,
    metrics: model.getStatistics(),
  };
}
