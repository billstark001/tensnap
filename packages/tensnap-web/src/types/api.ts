import { Agent, Environment, Parameter } from "./modeling";

// 消息类型枚举
export type WSMessageType =
  | 'time_step_start'
  | 'time_step_end'
  | 'environment_update'
  | 'agent_update'
  | 'agent_batch_update'
  | 'parameters'
  | 'environments_list'
  | 'chart_data'
  | 'get_state'
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

// 返回参数列表
export type ParametersPayload = Parameter[];

// environments_list
export type EnvironmentsListPayload = Environment[];

// chart_data
export interface ChartDataUpdate {
  id: string;
  time: number;
  value: any;
}
export type ChartDataPayload = ChartDataUpdate[];

// get_state
export interface GetStatePayload {} // 空对象

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
  | ParametersPayload
  | EnvironmentsListPayload
  | ChartDataPayload
  | GetStatePayload
  | ParameterChangePayload
  | ButtonClickPayload
  | ErrorPayload;

export type IncomingWSMessage = WSMessage<IncomingPayload>;
