import { CreateStoreFunction } from '@/utils/zustand';
import { EnvironmentsSlice, ScenarioStore } from '../types';

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
    set();
  },

  updateAgents: (envId, updates) => {
    if (!updates || updates.length === 0) return;
    const { environments, log, parameterUpdateTrigger: { set } } = get();
    const env = environments.get(envId);
    if (!env) {
      log(`Environment with id ${envId} not found.`, 'warning');
      return;
    }
    
    const { agents } = env;
    for (const { id, data } of updates) {
      if (!agents[id]) {
        log(`Agent with id ${id} not found in ${env.type} environment ${envId}.`, 'warning');
        continue;
      }
      Object.assign(agents[id], data);
    }
    env.agents = agents;
    set();
  },
});