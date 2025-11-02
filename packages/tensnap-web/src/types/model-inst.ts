import { Agent, AgentId, Environment, EnvironmentId, EnvironmentType, GraphAgent, GridAgent, PureEnvironment, PureGraphEnvironment, PureGridEnvironment, UniformAgent } from "./model";

export interface InstantiatedEnvironment {
  id: EnvironmentId;
  type: EnvironmentType;
  props: PureEnvironment;
  agents: Record<AgentId, Agent>;
}

export interface InstantiatedGridEnvironment extends InstantiatedEnvironment {
  type: 'grid';
  props: Omit<PureGridEnvironment, 'type' | 'id'>;
  agents: Record<AgentId, GridAgent>;
}

export interface InstantiatedGraphEnvironment extends InstantiatedEnvironment {
  type: 'graph';
  props: Omit<PureGraphEnvironment, 'type' | 'id'>;
  agents: Record<AgentId, GraphAgent>;
}

export interface InstantiatedUniformEnvironment extends InstantiatedEnvironment {
  type: 'uniform';
  props: Omit<PureEnvironment, 'type' | 'id'>;
  agents: Record<AgentId, UniformAgent>;
}

export function instantiateEnvironment(env: Environment): InstantiatedEnvironment {

  const { id, type, agents, ...props } = env;

  const agentsMap: Record<AgentId, Agent> = {};
  agents.forEach(agent => {
    agentsMap[agent.id] = agent;
  });

  return {
    id,
    type,
    props,
    agents: agentsMap,
  };
}

export function serializeEnvironment(instEnv: InstantiatedEnvironment): Environment {
  const { id, type, props, agents } = instEnv;

  return {
    id,
    type,
    ...props,
    agents: Object.values(agents),
  } as any;
}