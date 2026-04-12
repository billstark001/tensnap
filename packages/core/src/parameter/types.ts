
export type ParameterType = 'number' | 'enum' | 'boolean' | 'string';

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

export interface BooleanParameter extends ParameterBase {
  type: 'boolean';
  value: boolean;
}

export interface StringParameter extends ParameterBase {
  type: 'string';
  value: string;
}

export type Parameter = NumberParameter | EnumParameter | BooleanParameter | StringParameter;

// ---------------------------------------------------------------------------
// Action — separate from Parameter since v0.2
// ---------------------------------------------------------------------------

/** An action button registered by the server. */
export interface Action {
  id: string;
  label: string;
  /** Whether the client should keep firing action_start after each action_end. */
  continuous?: boolean;
  allowRuntimeChange?: boolean;
}
