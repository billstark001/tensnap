
export type ParameterType = 'number' | 'enum' | 'action' | 'boolean' | 'string';

export interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
  allowRuntimeChange?: boolean;
}

export interface NumberParameter extends ParameterBase {
  type: 'number';
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface EnumParameter extends ParameterBase {
  type: 'enum';
  value: string;
  options: string[];
  labels?: Record<string, string>;
}

export interface ActionParameter extends ParameterBase {
  type: 'action';
}

export interface BooleanParameter extends ParameterBase {
  type: 'boolean';
  value: boolean;
}

export interface StringParameter extends ParameterBase {
  type: 'string';
  value: string;
}

export type Parameter = NumberParameter | EnumParameter | ActionParameter | BooleanParameter | StringParameter;
