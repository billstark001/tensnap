import type { AgentRenderState } from '@tensnap/core/environment';
import type { BenchmarkCase } from '../types';
import { createComponentEnvironment } from './componentEnvironment';

interface Particle extends AgentRenderState { id: string; x: number; y: number; vx: number; vy: number }
interface Config { particleCount: number; worldWidth: number; worldHeight: number; width: number; height: number; maxSpeed: number }

export function createParticleBounceCase(partial: Partial<Config> = {}): BenchmarkCase {
  const config: Config = {
    particleCount: partial.particleCount ?? 2_000, worldWidth: partial.worldWidth ?? 100,
    worldHeight: partial.worldHeight ?? 70, width: partial.width ?? 900, height: partial.height ?? 630,
    maxSpeed: partial.maxSpeed ?? 0.7,
  };
  return {
    name: 'Environment2DView particle bounce', category: 'component', config: { ...config },
    async mount(container) {
      const particles: Particle[] = Array.from({ length: config.particleCount }, (_, index) => ({
        id: `p_${index}`, x: Math.random() * config.worldWidth, y: Math.random() * config.worldHeight,
        vx: (Math.random() * 2 - 1) * config.maxSpeed, vy: (Math.random() * 2 - 1) * config.maxSpeed,
        icon: 'circle', size: 0.8, color: `hsl(${index % 360} 70% 55%)`,
      }));
      const environment = createComponentEnvironment({ agents: particles, width: config.worldWidth, height: config.worldHeight });
      const { mountWebEnvironmentBenchmark } = await import('@tensnap/web/benchmark');
      const mounted = await mountWebEnvironmentBenchmark(container, { scenario: environment.scenario, environmentId: 'main', display: '2d', width: config.width, height: config.height });
      return {
        kind: 'component',
        tick() {
          for (const particle of particles) {
            particle.x += particle.vx; particle.y += particle.vy;
            if (particle.x < 0 || particle.x > config.worldWidth) { particle.vx *= -1; particle.x = Math.max(0, Math.min(config.worldWidth, particle.x)); }
            if (particle.y < 0 || particle.y > config.worldHeight) { particle.vy *= -1; particle.y = Math.max(0, Math.min(config.worldHeight, particle.y)); }
          }
          environment.agents.updateAgents(particles);
        },
        destroy: mounted.destroy,
      };
    },
  };
}
