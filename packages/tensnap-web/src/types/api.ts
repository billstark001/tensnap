import { Agent, Environment, Parameter } from "./modeling";

// 服务器到客户端的消息类型
export type ServerToClientMessageType =
  | 'time_step_start'
  | 'time_step_end'
  | 'environment_update'
  | 'agent_update'
  | 'agent_batch_update'
  | 'chart_data'
  | 'state_sync'
  | 'error';

// 客户端到服务器的消息类型
export type ClientToServerMessageType =
  | 'state_sync'
  | 'parameter_change'
  | 'button_click'
  | 'error';

// 全部消息类型（向后兼容）
export type WSMessageType = ServerToClientMessageType | ClientToServerMessageType;

// 通用消息结构
export interface WSMessage<T = any> {
  type: WSMessageType;
  payload: T;
  timestamp?: number;
}

// 服务器到客户端的消息结构
export interface ServerToClientMessage<T = any> {
  type: ServerToClientMessageType;
  payload: T;
  timestamp?: number;
}

// 客户端到服务器的消息结构
export interface ClientToServerMessage<T = any> {
  type: ClientToServerMessageType;
  payload: T;
  timestamp?: number;
}

// ---------- 消息体定义 ----------

// time_step_start - time 参数必须
export interface TimeStepStartPayload {
  time: number;
}

// time_step_end - time 参数可选，用于前端验证
export interface TimeStepEndPayload {
  time?: number;
}

// environment_update
export interface EnvironmentUpdatePayload {
  id: string | number;
  data: Environment;
}

// agent_update
export interface AgentUpdatePayload {
  environment_id: string | number;
  agent_id: string | number;
  data: Agent; // 建议具体化为 Agent 数据结构
}

// agent_batch_update
export interface AgentBatchUpdatePayload {
  environment_id: string | number;
  updates: Array<{
    id: string | number;
    data: Agent;
  }>;
}


// chart_data
export interface ChartDataUpdate {
  id: string;
  time?: number;
  value: any;
}
export type ChartDataPayload = ChartDataUpdate[];

// state_sync - 统一的状态同步（请求和响应）
export interface StateSyncRequest {
  parameters: string[];  // 参数ID列表
  environments: (string | number)[];  // 环境ID列表
  charts: string[];  // 图表ID列表
  parameter_cache: Record<string, any>;  // 参数的缓存值
}

export interface StateSyncResponse {
  added_parameters: Parameter[];
  removed_parameters: string[];
  updated_parameters: Parameter[];
  added_environments: Environment[];
  removed_environments: (string | number)[];
  updated_environments: Environment[];
  added_charts: ChartState[];
  removed_charts: string[];
  updated_charts: ChartState[];
}

// Chart state definition for communication (without data field)
export interface ChartState {
  id: string;
  label: string;
  color?: string;
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

// ---------- 服务器到客户端的消息类型 ----------

export type ServerToClientPayload =
  | TimeStepStartPayload
  | TimeStepEndPayload
  | EnvironmentUpdatePayload
  | AgentUpdatePayload
  | AgentBatchUpdatePayload
  | ChartDataPayload
  | StateSyncResponse
  | ErrorPayload;

export type ServerToClientWSMessage = ServerToClientMessage<ServerToClientPayload>;

// ---------- 客户端到服务器的消息类型 ----------

export type ClientToServerPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ButtonClickPayload;

export type ClientToServerWSMessage = ClientToServerMessage<ClientToServerPayload>;

// ---------- 综合消息类型（向后兼容）----------

export type IncomingPayload = ServerToClientPayload | ClientToServerPayload;

export type IncomingWSMessage = WSMessage<IncomingPayload>;
