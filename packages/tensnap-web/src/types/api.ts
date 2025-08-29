import { Agent, Environment, Parameter } from "./modeling";

// 消息类型枚举
export type WSMessageType =
  | 'time_step_start'
  | 'time_step_end'
  | 'environment_update'
  | 'agent_update'
  | 'agent_batch_update'
  | 'chart_data'
  | 'state_sync'  // 统一的状态同步消息
  | 'parameter_change'
  | 'button_click'
  | 'error';

// 通用消息结构
export interface WSMessage<T = any> {
  type: WSMessageType;
  payload: T;
  timestamp?: number;
}

// ---------- 消息体定义 ----------

// time_step_start, time_step_end
export interface TimeStepPayload {
  time: number;
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

// Parameter 类型定义
export type ParameterType = 'slider' | 'enum' | 'other'; // 可扩展

export interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
  value: any;
  allow_runtime_change: boolean;  // 新增：是否允许模型正在迭代时更改
}

export interface SliderParameter extends ParameterBase {
  type: 'slider';
  min: number;
  max: number;
  step: number;
}

export interface EnumParameter extends ParameterBase {
  type: 'enum';
  options: string[] | {label: string; value: any}[];
}


// chart_data
export interface ChartDataUpdate {
  id: string;
  time: number;
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

// Chart state definition for communication
export interface ChartState {
  id: string;
  label: string;
  color?: string;
  data: Array<{ time: number; value: number }>;
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

// ---------- 综合消息类型 ----------

export type IncomingPayload =
  | TimeStepPayload
  | EnvironmentUpdatePayload
  | AgentUpdatePayload
  | AgentBatchUpdatePayload
  | ChartDataPayload
  | StateSyncRequest
  | StateSyncResponse
  | ParameterChangePayload
  | ButtonClickPayload
  | ErrorPayload;

export type IncomingWSMessage = WSMessage<IncomingPayload>;
