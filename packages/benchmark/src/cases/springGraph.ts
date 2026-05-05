/**
 * cases/springGraph.ts
 *
 * Benchmark: EnvironmentView with a random Erdős–Rényi graph driven by
 * d3-force spring layout (EdgeLayer).
 *
 * Graph construction: N nodes, each pair of nodes connected with
 * probability `edgeProbability` (E-R model G(n,p)).
 *
 * Benchmark tick strategy:
 *   Each tick we slightly perturb a random subset of nodes' positions and
 *   call agentStorage.updateAgents() for only the changed nodes. This still
 *   reheats the d3 simulation, but avoids a full agent-map replacement every
 *   frame.
 */

import { AgentStorage, EdgeStorage, AgentLayer, EdgeLayer, AgentRenderState } from '@tensnap/core/environment';
import { EnvironmentView } from '@tensnap/core/environment/browser';
import { GraphEdge } from '@tensnap/core/environment';
import { BenchmarkCase } from '../types';

interface Config {
  /** Number of nodes. */
  nodeCount: number;
  /** Edge probability for E-R model (0–1). */
  edgeProbability: number;
  /** Canvas width. */
  width: number;
  /** Canvas height. */
  height: number;
  /** Fraction of nodes perturbed per tick. */
  perturbFraction: number;
}

const NODE_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2',
  '#59a14f', '#edc948', '#b07aa1', '#ff9da7',
  '#9c755f', '#bab0ac',
];

function buildERGraph(n: number, p: number, W: number, H: number): {
  nodes: AgentRenderState[];
  edges: GraphEdge[];
} {
  // Nodes are initialised in scene coordinates centred at the origin (0, 0).
  // EdgeLayer's d3-force centre force is fixed at the scene origin, so the
  // initial layout must be centred there too; otherwise nodes drift to a corner.
  const nodes: AgentRenderState[] = Array.from({ length: n }, (_, i) => ({
    id: `n_${i}`,
    x: (Math.random() - 0.5) * W * 0.8,
    y: (Math.random() - 0.5) * H * 0.8,
    size: 1,
    icon: 'circle' as const,
    color: NODE_COLORS[i % NODE_COLORS.length],
  }));

  const edges: GraphEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.random() < p) {
        edges.push({ source: `n_${i}`, target: `n_${j}` });
      }
    }
  }
  return { nodes, edges };
}

export function createSpringGraphCase(partial: Partial<Config> = {}): BenchmarkCase {
  const cfg: Config = {
    nodeCount: partial.nodeCount ?? 60,
    edgeProbability: partial.edgeProbability ?? 0.08,
    width: partial.width ?? 800,
    height: partial.height ?? 600,
    perturbFraction: partial.perturbFraction ?? 0.1,
  };

  let view: EnvironmentView | null = null;
  let agentStorage: AgentStorage | null = null;
  let edgeStorage: EdgeStorage | null = null;
  let host: HTMLElement | null = null;
  let nodes: AgentRenderState[] = [];

  return {
    name: 'EnvironmentView (E-R spring graph)',
    config: cfg as unknown as Record<string, unknown>,

    setup(container) {
      host = document.createElement('div');
      host.style.cssText = `
        width: ${cfg.width}px; height: ${cfg.height}px;
        overflow: hidden;
      `;
      container.appendChild(host);

      view = new EnvironmentView(host, {
        throttleMs: 0,
      });

      agentStorage = new AgentStorage();
      edgeStorage = new EdgeStorage([]);

      const edgeLayer = new EdgeLayer(edgeStorage, agentStorage, );
      const agentLayer = new AgentLayer(agentStorage, {
        ...edgeLayer.buildDragHandlers(),
        draggable: false,
        clickable: false,
      });

      view.addLayer(edgeLayer);
      view.addLayer(agentLayer);

      // Build E-R graph and load initial data
      const { nodes: ns, edges } = buildERGraph(
        cfg.nodeCount,
        cfg.edgeProbability,
        cfg.width,
        cfg.height,
      );
      nodes = ns;
      agentStorage.setAgents(nodes);
      edgeStorage.setEdges(edges);

      view.fitToScene();
    },

    tick(frameIndex) {
      const currentAgents = agentStorage!.getData().agents;
      const perturbCount = Math.min(
        nodes.length,
        Math.max(1, Math.floor(cfg.nodeCount * cfg.perturbFraction)),
      );
      const perturbedIndexes = new Set<number>();
      while (perturbedIndexes.size < perturbCount) {
        perturbedIndexes.add(Math.floor(Math.random() * nodes.length));
      }

      const updates: Array<Pick<AgentRenderState, 'id' | 'x' | 'y'>> = [];
      for (const idx of perturbedIndexes) {
        const node = nodes[idx];
        if (!node) {
          continue;
        }
        const current = currentAgents.get(node.id);
        const nextX = (current?.x ?? node.x ?? 0) + (Math.random() * 20 - 10);
        const nextY = (current?.y ?? node.y ?? 0) + (Math.random() * 20 - 10);
        node.x = nextX;
        node.y = nextY;
        updates.push({ id: node.id, x: nextX, y: nextY });
      }

      if (updates.length > 0) {
        agentStorage!.updateAgents(updates);
      }

      void frameIndex;
    },

    teardown() {
      view?.destroy();
      host?.remove();
      view = null;
      agentStorage = null;
      edgeStorage = null;
      host = null;
      nodes = [];
    },
  };
}
