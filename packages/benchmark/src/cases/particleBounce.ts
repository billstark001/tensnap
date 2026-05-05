/**
 * cases/particleBounce.ts
 *
 * Benchmark: EnvironmentView with N free-flying particles that bounce off walls.
 *
 * Each tick:
 *   - Update particle positions using velocity (basic Euler integration)
 *   - Reflect velocity when a particle hits a boundary
 *   - Call agentStorage.updateAgents() to trigger re-render
 */

import { GridEnvStorage, GridLayer } from '@tensnap/core/environment';
import { EnvironmentView } from '@tensnap/core/environment/browser';
import { AgentStorage } from '@tensnap/core/environment';
import { AgentLayer } from '@tensnap/core/environment';
import { AgentRenderState } from '@tensnap/core/environment';
import { BenchmarkCase } from '../types';

interface Config {
  /** Number of particles. */
  particleCount: number;
  /** Environment width. */
  width: number;
  /** Environment height. */
  height: number;
  /* Canvas scale factor (px per scene unit). */
  canvasScale: number;
  /** Max initial speed (px/frame). */
  maxSpeed: number;
}

interface Particle extends AgentRenderState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const PARTICLE_COLORS = [
  '#4fc3f7', '#81c784', '#ffb74d', '#f48fb1',
  '#ce93d8', '#80cbc4', '#fff176', '#ef9a9a',
];

export function createParticleBounceCase(partial: Partial<Config> = {}): BenchmarkCase {
  const cfg: Config = {
    particleCount: partial.particleCount ?? 200,
    width: partial.width ?? 80,
    height: partial.height ?? 50,
    canvasScale: partial.canvasScale ?? 10,
    maxSpeed: partial.maxSpeed ?? 4,
  };

  let view: EnvironmentView | null = null;
  let agentStorage: AgentStorage | null = null;
  let host: HTMLElement | null = null;
  let particles: Particle[] = [];

  function initParticles(): Particle[] {
    return Array.from({ length: cfg.particleCount }, (_, i) => ({
      id: `p_${i}`,
      x: Math.random() * cfg.width,
      y: Math.random() * cfg.height,
      vx: (Math.random() * 2 - 1) * cfg.maxSpeed,
      vy: (Math.random() * 2 - 1) * cfg.maxSpeed,
      icon: 'circle' as const,
      size: 1,
      color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
    }));
  }

  function stepParticles(): void {
    const W = cfg.width;
    const H = cfg.height;
    const R = 0.5; // effective radius for bounce boundary

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < R) { p.x = R; p.vx = Math.abs(p.vx); }
      else if (p.x > W - R) { p.x = W - R; p.vx = -Math.abs(p.vx); }

      if (p.y < R) { p.y = R; p.vy = Math.abs(p.vy); }
      else if (p.y > H - R) { p.y = H - R; p.vy = -Math.abs(p.vy); }
    }
  }

  return {
    name: 'EnvironmentView (particle bounce)',
    suite: 'synthetic' as const,
    config: cfg as unknown as Record<string, unknown>,

    setup(container) {
      host = document.createElement('div');
      host.style.cssText = `
        width: ${cfg.width * cfg.canvasScale}px; height: ${cfg.height * cfg.canvasScale}px;
        overflow: hidden;
      `;
      container.appendChild(host);

      view = new EnvironmentView(host, {
        throttleMs: 0,
      });
      view.setViewport(0, 0, cfg.width, cfg.height);

      const gridEnvStorage = new GridEnvStorage();
      const gridLayer = new GridLayer(gridEnvStorage);
      view.addLayer(gridLayer);

      agentStorage = new AgentStorage();
      const agentLayer = new AgentLayer(agentStorage, {
        clickable: false,
        draggable: false,
        coordOffset: 'float',
        sceneBounds: { width: cfg.width, height: cfg.height },
      });
      view.addLayer(agentLayer);

      particles = initParticles();
      agentStorage.setAgents(particles);
    },

    tick() {
      stepParticles();
      agentStorage!.updateAgents(particles);
    },

    teardown() {
      view?.destroy();
      host?.remove();
      view = null;
      agentStorage = null;
      host = null;
      particles = [];
    },
  };
}
