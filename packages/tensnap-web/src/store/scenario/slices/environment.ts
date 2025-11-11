import { CreateStoreFunction } from '@/utils/zustand';
import { EnvironmentsSlice, ScenarioStore } from '../types';
import { Agent, AgentTrajectoryPoint, GridAgent } from '@/types/model';
import { InstantiatedGridEnvironment } from '../environment';

export const createEnvironmentsSlice: CreateStoreFunction<EnvironmentsSlice, ScenarioStore> = (_, get) => ({
  environments: new Map(),

  renameEnvironment: (id, newId) => {
    const { environments, log, parameterUpdateTrigger: { set } } = get();
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
  
  updateEnvironment: (id, propsUpdate, agentsUpdate) => {
    const { environments, log, parameterUpdateTrigger: { set } } = get();
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

  updateAgents: (envId, updates) => {
    if (!updates || updates.length === 0) return;
    const { environments, log, parameterUpdateTrigger: { set }, currentTime } = get();
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
              if (traceArr.length > trajectory_length) {
                traceArr.splice(0, traceArr.length - trajectory_length);
              }
            } else {
              // infinite length, optimize for identical points
              const lastElement = traceArr[traceArr.length - 1];
              if (!lastElement || lastElement.x !== x && lastElement.y !== y) {
                traceArr.push(currentTrajectoryPoint);
              }
            }
          }
        }
      }

    }
    env.agents = agents;
    set();
  },
});