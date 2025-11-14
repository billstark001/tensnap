import {
  Agent, AgentId, 
  AgentTrajectoryPoint, 
  Environment, EnvironmentId, EnvironmentType, GraphAgent, GridAgent,
  PureEnvironment, PureGraphEnvironment, PureGridEnvironment, PureUniformEnvironment,
  UniformAgent
  } from "../../types/model";

export interface InstantiatedEnvironment {
  id: EnvironmentId;
  type: EnvironmentType;
  label: string;
  props: PureEnvironment;
  agents: Record<AgentId, Agent>;
  tiles: Record<AgentId, Tile>;
}

export interface InstantiatedGridEnvironment extends InstantiatedEnvironment {
  type: 'grid';
  props: PureGridEnvironment;
  agents: Record<AgentId, GridAgent>;
  tiles: Record<AgentId, Tile>;
  agentTraces: Record<AgentId, AgentTrajectoryPoint[]>;
}

export interface InstantiatedGraphEnvironment extends InstantiatedEnvironment {
  type: 'graph';
  props: PureGraphEnvironment;
  agents: Record<AgentId, GraphAgent>;
  tiles: Record<AgentId, Tile>;
}

export interface InstantiatedUniformEnvironment extends InstantiatedEnvironment {
  type: 'uniform';
  props: PureUniformEnvironment;
  agents: Record<AgentId, UniformAgent>;
  tiles: Record<AgentId, Tile>;
}

export function instantiateEnvironment(env: Environment): InstantiatedEnvironment {

  const { id, type, label: _label, agents, tiles, ...props } = env;

  const agentsMap: Record<AgentId, Agent> = {};
  agents.forEach(agent => {
    agentsMap[agent.id] = agent;
  });

  const tilesMap: Record<AgentId, Tile> = {};
  if (tiles) {
    tiles.forEach(tile => {
      tilesMap[tile.id] = tile;
    });
  }

  const label = _label || (typeof id === 'string' ? id : `env-${type}-${id}`);

  const ret: InstantiatedEnvironment = {
    id,
    type,
    label,
    props,
    agents: agentsMap,
    tiles: tilesMap,
  };

  if (type === 'grid') {
    (ret as InstantiatedGridEnvironment).agentTraces = {};
  }

  return ret;
}

export function serializeEnvironment(instEnv: InstantiatedEnvironment): Environment {
  const { id, type, props, agents, tiles } = instEnv;

  return {
    id,
    type,
    ...structuredClone(props),
    agents: structuredClone(Object.values(agents)),
    tiles: structuredClone(Object.values(tiles)),
  } as any;
}
