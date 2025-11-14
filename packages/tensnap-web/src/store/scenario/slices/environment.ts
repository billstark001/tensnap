import { CreateStoreFunction } from '@/utils/zustand';
import { EnvironmentsSlice, ScenarioStore } from '../types';
import { Agent, AgentTrajectoryPoint, GridAgent, Tile } from '@/types/model';
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
  
  updateEnvironment: (id, propsUpdate, agentsUpdate, tilesUpdate) => {
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

    // replace all tiles if tilesUpdate is provided
    const newTiles = tilesUpdate 
      ? Object.fromEntries(tilesUpdate.map(t => [t.id, t]))
      : env.tiles;

    Object.assign(env.props, propsUpdate);
    env.agents = newAgents;
    env.tiles = newTiles;
    if (env.type === 'grid' && agentsUpdate) {
      (env as InstantiatedGridEnvironment).agentTraces = {};
    }
    set();
  },

  updateAgents: (envId, updates) => {
    if (!updates || updates.length === 0) return;
    const { environments, log, environmentUpdateTrigger: { set }, currentTime } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    
    const { agents, type } = env;
    for (const { id, data, operation } of updates) {
      let currentAgent = agents[id];
      if (operation === 'create') {
        if (!data) {
          log(`Newly created agent with id ${id} is not supplied with agent data.`, 'warning');
        }
        const newAgent: Agent = {
          id,
          ...data
        };
        if (type === 'grid') {
          (newAgent as GridAgent).x ??= 0;
          (newAgent as GridAgent).y ??= 0;
          (newAgent as GridAgent).heading ??= 0;
        }
        agents[id] = newAgent;
        currentAgent = newAgent;
      } else if (operation === 'delete') {
        if (!currentAgent) {
          log(`Agent with id ${id} not found in ${env.type} environment ${envId}.`, 'warning');
          continue;
        }
        Object.assign(currentAgent, data);
        delete agents[id];
        if (type === 'grid') {
          delete (env as InstantiatedGridEnvironment).agentTraces[id];
        }
      } else {
        if (!currentAgent) {
          log(`Agent with id ${id} not found in ${env.type} environment ${envId}.`, 'warning');
          continue;
        }
        if (data?.id && data?.id !== currentAgent.id) {
          log(`Agent with id ${id} is being updated with a different id.`, 'warning');
        }
        Object.assign(currentAgent, data);
        // draw trajectory if necessary
        if (type === 'grid') {
          const props = (env as InstantiatedGridEnvironment).props;
          const {
            x,
            y,
            trajectory_length = props.trajectory_length,
            trajectory_color = props.trajectory_color
          } = (currentAgent as GridAgent);
          if (!trajectory_length) {
            continue;
          }
          const currentTrajectoryPoint: AgentTrajectoryPoint = {
            x, y, color: trajectory_color, time: currentTime,
          };
          if ((env as InstantiatedGridEnvironment).agentTraces[id] == null) {
            (env as InstantiatedGridEnvironment).agentTraces[id] = [currentTrajectoryPoint];
          } else {
            const traceArr = (env as InstantiatedGridEnvironment).agentTraces[id];
            if (trajectory_length > 0) {
              // finite
              traceArr.push(currentTrajectoryPoint);
              if (traceArr.length > trajectory_length + 1) {
                traceArr.splice(0, traceArr.length - trajectory_length - 1);
              }
            } else {
              // infinite length with safety limit to prevent unbounded memory growth
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

    }
    env.agents = agents;
    set();
  },

  updateTiles: (envId, updates) => {
    if (!updates || updates.length === 0) return;
    const { environments, log, environmentUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    
    const { tiles } = env;
    for (const { id, data, operation } of updates) {
      let currentTile = tiles[id];
      if (operation === 'create') {
        if (!data) {
          log(`Newly created tile with id ${id} is not supplied with tile data.`, 'warning');
        }
        const newTile: Tile = {
          id,
          x: 0,
          y: 0,
          ...data
        };
        tiles[id] = newTile;
        currentTile = newTile;
      } else if (operation === 'delete') {
        if (!currentTile) {
          log(`Tile with id ${id} not found in ${env.type} environment ${envId}.`, 'warning');
          continue;
        }
        Object.assign(currentTile, data);
        delete tiles[id];
      } else {
        if (!currentTile) {
          log(`Tile with id ${id} not found in ${env.type} environment ${envId}.`, 'warning');
          continue;
        }
        if (data?.id && data?.id !== currentTile.id) {
          log(`Tile with id ${id} is being updated with a different id.`, 'warning');
        }
        Object.assign(currentTile, data);
      }
    }
    env.tiles = tiles;
    set();
  },
});