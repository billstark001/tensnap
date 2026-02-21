import { CreateStoreFunction } from '@/utils/zustand';
import { EnvironmentsSlice, ScenarioStore } from '../types';
import { AgentTrajectoryPoint, GridAgent } from '@/types/model';
import { AgentDiff, EdgeData, EdgeDiff } from '@/types/api';
import { InstantiatedGridEnvironment } from '../environment';

// 为无限长度轨迹设置安全上限，防止内存无限增长
const MAX_TRAJECTORY_POINTS = 32768;

export const createEnvironmentsSlice: CreateStoreFunction<EnvironmentsSlice, ScenarioStore> = (_, get) => ({
  environments: new Map(),

  renameEnvironment: (id, newId) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(id);
    if (!env) {
      log(`Environment with id ${id} not found.`, 'warning');
      return;
    }
    if (environments.has(newId)) {
      log(`Environment with id ${newId} already exists.`, 'warning');
      return;
    }
    env.id = newId;
    environments.delete(id);
    environments.set(newId, env);
    set();
  },

  removeEnvironment: (id) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(id);
    if (!env) {
      log(`Environment with id ${id} not found.`, 'warning');
      return;
    }

    // 显式清理环境中的所有引用以防止内存泄漏
    if (env.type === 'grid') {
      (env as InstantiatedGridEnvironment).agentTraces = {};
    }
    env.agents = {};

    environments.delete(id);
    set();
  },

  /** Create a new empty environment container. */
  createEnv: (id, type) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    if (environments.has(id)) {
      log(`Environment with id ${id} already exists.`, 'warning');
      return;
    }
    // Map v0.2 type to internal type
    const internalType = type === '2d' ? 'grid' : 'uniform';
    const newEnv: any = {
      id,
      type: internalType,
      agents: {},
      props: {},
      ...(internalType === 'grid' ? { agentTraces: {} } : {}),
    };
    environments.set(id, newEnv);
    set();
  },

  deleteEnv: (id) => {
    get().removeEnvironment(id);
  },

  /** Update the layer metadata (e.g., grid width/height). */
  createEnvLayer: (envId, _layerId, _layerType, data) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    if (data) {
      Object.assign(env.props, data);
    }
    set();
  },

  updateEnvLayer: (envId, _layerId, data) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    Object.assign(env.props, data);
    set();
  },

  deleteEnvLayer: (envId, _layerId) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    env.agents = {};
    if (env.type === 'grid') {
      (env as InstantiatedGridEnvironment).agentTraces = {};
    }
    set();
  },

  updateEnvironment: (id, propsUpdate, agentsUpdate) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(id);
    if (!env) {
      log(`Environment with id ${id} not found.`, 'warning');
      return;
    }

    // replace all agents if agentsUpdate is provided
    const newAgents = agentsUpdate
      ? Object.fromEntries(agentsUpdate.map(a => [a.id, a]))
      : env.agents;

    Object.assign(env.props, propsUpdate);
    env.agents = newAgents;
    if (env.type === 'grid' && agentsUpdate) {
      (env as InstantiatedGridEnvironment).agentTraces = {};
    }
    set();
  },

  /** Create agents (batch). */
  createAgents: (envId, _layerId, agents) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    for (const agent of agents) {
      if (!agent.id && agent.id !== 0) continue;
      env.agents[agent.id] = { ...agent };
    }
    set();
  },

  /** Update agents via flat diff (v0.2 format). */
  updateAgents: (envId, _layerId, agentDiffs) => {
    if (!agentDiffs || agentDiffs.length === 0) return;
    const { environments, log, environmentUpdateTrigger: { set }, currentTime } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }

    const { agents, type } = env;
    for (const diff of agentDiffs) {
      const { id, ...rest } = diff as AgentDiff;
      const currentAgent = agents[id];
      if (!currentAgent) {
        log(`Agent with id ${id} not found in environment ${envId}.`, 'warning');
        continue;
      }
      Object.assign(currentAgent, rest);
      // draw trajectory if necessary
      if (type === 'grid') {
        const props = (env as InstantiatedGridEnvironment).props;
        const {
          x,
          y,
          trajectory_length = props.trajectory_length,
          trajectory_color = props.trajectory_color
        } = (currentAgent as GridAgent);
        if (!trajectory_length) continue;
        const currentTrajectoryPoint: AgentTrajectoryPoint = {
          x, y, color: trajectory_color, time: currentTime,
        };
        if ((env as InstantiatedGridEnvironment).agentTraces[id] == null) {
          (env as InstantiatedGridEnvironment).agentTraces[id] = [currentTrajectoryPoint];
        } else {
          const traceArr = (env as InstantiatedGridEnvironment).agentTraces[id];
          if (trajectory_length > 0) {
            traceArr.push(currentTrajectoryPoint);
            if (traceArr.length > trajectory_length + 1) {
              traceArr.splice(0, traceArr.length - trajectory_length - 1);
            }
          } else {
            const lastElement = traceArr[traceArr.length - 1];
            if (!lastElement || lastElement.x !== x || lastElement.y !== y) {
              traceArr.push(currentTrajectoryPoint);
              if (traceArr.length > MAX_TRAJECTORY_POINTS) {
                traceArr.splice(0, traceArr.length - MAX_TRAJECTORY_POINTS);
              }
            }
          }
        }
      }
    }
    env.agents = agents;
    set();
  },

  /** Delete agents by id (batch). */
  deleteAgents: (envId, _layerId, ids) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    for (const id of ids) {
      delete env.agents[id];
      if (env.type === 'grid') {
        delete (env as InstantiatedGridEnvironment).agentTraces[id];
      }
    }
    set();
  },

  /** Create edges (graph env only, batch). */
  createEdges: (envId, _layerId, edges: EdgeData[]) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId) as any;
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    if (!env.props.edges) env.props.edges = [];
    for (const edge of edges) {
      // deduplicate by (source, target)
      const idx = env.props.edges.findIndex(
        (e: any) => e.source === edge.source && e.target === edge.target
      );
      if (idx === -1) {
        env.props.edges.push(edge);
      } else {
        env.props.edges[idx] = { ...env.props.edges[idx], ...edge };
      }
    }
    set();
  },

  /** Update edges via flat diff (batch). */
  updateEdges: (envId, _layerId, edges: EdgeDiff[]) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId) as any;
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    if (!env.props.edges) return;
    for (const diff of edges) {
      const idx = env.props.edges.findIndex(
        (e: any) => e.source === diff.source && e.target === diff.target
      );
      if (idx !== -1) {
        Object.assign(env.props.edges[idx], diff);
      }
    }
    set();
  },

  /** Delete edges by (source, target) key (batch). */
  deleteEdges: (envId, _layerId, edges) => {
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId) as any;
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    if (!env.props.edges) return;
    const toDelete = new Set(edges.map(e => `${e.source}::${e.target}`));
    env.props.edges = env.props.edges.filter(
      (e: any) => !toDelete.has(`${e.source}::${e.target}`)
    );
    set();
  },
});
