import { Agent, AgentId, ChartUpdateData, ChartMetadata, Environment, EnvironmentId, Parameter, PureEnvironment, ChartMetadataWithList } from "./model";

//#region Message Types

// Server to client message types
export type ServerToClientMessageType =
  | 'time_step_start'
  | 'time_step_end'
  | 'environment_update'
  | 'agent_update'
  | 'agent_batch_update'
  | 'chart_update'
  | 'state_sync'
  | 'log'
  | 'error';

// Client to server message types
export type ClientToServerMessageType =
  | 'state_sync'
  | 'parameter_change'
  | 'button_click'
  | 'error';

// All message types
export type WSMessageType = ServerToClientMessageType | ClientToServerMessageType;

//#endregion

//#region Base Message Structures

// Generic message structure
export interface WSMessage<T = any> {
  type: WSMessageType;
  payload: T;
  timestamp?: number;
}

// Server to client message structure
export interface ServerToClientMessage<T = any> {
  type: ServerToClientMessageType;
  payload: T;
  timestamp?: number;
}

// Client to server message structure
export interface ClientToServerMessage<T = any> {
  type: ClientToServerMessageType;
  payload: T;
  timestamp?: number;
}

//#endregion

//#region Payload Definitions

// time_step_start - time parameter is required
export interface TimeStepStartPayload {
  time: number;
}

// time_step_end - time parameter is optional, used for frontend validation
export interface TimeStepEndPayload {
  time?: number;
}

// environment_update
export interface EnvironmentUpdatePayload {
  id: EnvironmentId;
  data: PureEnvironment;
}

// agent_update
export interface AgentUpdatePayload {
  environment_id: EnvironmentId;
  agent_id: AgentId;
  data: Agent; // Recommend to specify as Agent data structure
}

// agent_batch_update
export interface AgentBatchUpdatePayload {
  environment_id: EnvironmentId;
  updates: Array<{
    id: AgentId;
    data: Agent;
  }>;
}

// chart_update
export type ChartUpdatePayload = ChartUpdateData[];

// log
export interface LogPayload {
  level: 'debug' | 'info' | 'warning' | 'error';
  target?: string;
  timestamp?: number;
  message: string;
}


// state_sync - Unified state synchronization (request and response)
export interface StateSyncRequest {
  parameters: Parameter[];  // Parameter ID list
  environments: PureEnvironment[];  // Environment ID list
  charts: ChartMetadata[];  // Chart ID list, only for telling if the chart exists, with group structure excluded
}

export interface StateSyncResponse {
  mode?: 'full' | 'incremental'; // Default is 'full'
  
  added_parameters: Parameter[];
  removed_parameters: string[];
  updated_parameters: Parameter[];

  added_environments: Environment[];
  removed_environments: EnvironmentId[];
  updated_environments: Environment[];

  added_charts: ChartMetadataWithList[];
  removed_charts: string[];
  updated_charts: ChartMetadataWithList[];

  clear_charts: boolean | string[]; // true means clear all charts, string[] means clear specific charts by IDs
}

// parameter_change
export interface ParameterChangePayload {
  id: string;
  value: any;
}

// button_click
export interface ButtonClickPayload {
  action: string;
}

// error
export interface ErrorPayload {
  error: string;
}

//#endregion

//#region Server to Client Message Types

export type ServerToClientPayload =
  | TimeStepStartPayload
  | TimeStepEndPayload
  | EnvironmentUpdatePayload
  | AgentUpdatePayload
  | AgentBatchUpdatePayload
  | ChartUpdatePayload
  | StateSyncResponse
  | LogPayload
  | ErrorPayload;

export type ServerToClientWSMessage = ServerToClientMessage<ServerToClientPayload>;

//#endregion

//#region Client to Server Message Types

export type ClientToServerPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ButtonClickPayload;

export type ClientToServerWSMessage = ClientToServerMessage<ClientToServerPayload>;

//#endregion

