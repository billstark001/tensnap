/**
 * environment/index.ts
 *
 * Public surface of the environment rendering system.
 *
 * Architecture overview
 * ─────────────────────
 *
 *  EnvironmentView
 *    │  Holds one Leafer instance and the container element.
 *    │  Handles throttled resize; notifies all registered layers.
 *    │
 *    ├─ BackgroundLayer  (z: 0)   ← BackgroundStorage
 *    ├─ GridLayer        (z: 10)  ← GridEnvStorage
 *    ├─ EdgeLayer        (z: 20)  ← EdgeStorage + AgentStorage (read + write-back)
 *    └─ AgentLayer       (z: 30)  ← AgentStorage [+ GridEnvStorage for grid mode]
 *
 *  Storage classes are reactive data containers; layers subscribe to them.
 *  EdgeLayer drives d3-force and back-writes positions to AgentStorage;
 *  it also exposes drag callbacks consumed by AgentLayer.
 *
 * Typical graph setup
 * ───────────────────
 *   const view        = new EnvironmentView(container);
 *   const agentStore  = new AgentStorage();
 *   const edgeStore   = new EdgeStorage(edges);
 *   const bgStore     = new BackgroundStorage();
 *
 *   const bgLayer     = new BackgroundLayer(view, bgStore);
 *   const edgeLayer   = new EdgeLayer(view, edgeStore, agentStore);
 *   const agentLayer  = new AgentLayer(view, agentStore, {
 *     ...edgeLayer.buildDragHandlers(),
 *   });
 *
 *   view.addLayer(bgLayer);
 *   view.addLayer(edgeLayer);
 *   view.addLayer(agentLayer);
 *
 *   agentStore.setAgents(myAgents);
 *   edgeStore.setEdges(myEdges);
 *
 * Typical grid setup
 * ──────────────────
 *   const view        = new EnvironmentView(container);
 *   const gridStore   = new GridEnvStorage({ width: 50, height: 50 });
 *   const agentStore  = new AgentStorage();
 *   const bgStore     = new BackgroundStorage();
 *
 *   const bgLayer     = new BackgroundLayer(view, bgStore);
 *   const gridLayer   = new GridLayer(view, gridStore);
 *   const agentLayer  = new AgentLayer(view, agentStore, {
 *     clickable: true,
 *     coordOffset: 'int',
 *   }, gridStore);
 *
 *   view.addLayer(bgLayer);
 *   view.addLayer(gridLayer);
 *   view.addLayer(agentLayer);
 */

export { EnvironmentView } from './EnvironmentView';
export type { IResizableLayer } from './EnvironmentView';

export * from './types';

export * from './utils';

export * from './layers';
export * from './storages';
