import type {
  Action,
  ActionInvokePayload,
  ActionKwargDefinition,
  ProtocolValue,
} from '@tensnap/protocol';
import type { ActionResultPayload } from '@tensnap/protocol';

type ActionExecutionError = NonNullable<ActionResultPayload['error']>;

export interface ValidatedActionInvocation {
  payload?: ActionInvokePayload;
  error?: ActionExecutionError;
}

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function error(code: string, message: string, data?: ProtocolValue): ValidatedActionInvocation {
  return { error: { code, message, data } };
}

function validateKwargValue(
  definition: ActionKwargDefinition,
  value: ProtocolValue,
): ActionExecutionError | undefined {
  switch (definition.type) {
    case 'number':
      if (typeof value !== 'number') return { code: 'invalid_kwargs', message: `${definition.name} must be a number.` };
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return { code: 'invalid_kwargs', message: `${definition.name} must be an integer.` };
      break;
    case 'string':
      if (typeof value !== 'string') return { code: 'invalid_kwargs', message: `${definition.name} must be a string.` };
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return { code: 'invalid_kwargs', message: `${definition.name} must be a boolean.` };
      break;
    case 'enum':
      if (typeof value !== 'string' || !definition.options?.includes(value)) {
        return { code: 'invalid_kwargs', message: `${definition.name} must be one of its declared options.` };
      }
      break;
    case 'json':
      break;
  }

  if (typeof value === 'number') {
    if (definition.min !== undefined && value < definition.min) {
      return { code: 'invalid_kwargs', message: `${definition.name} is below its minimum.` };
    }
    if (definition.max !== undefined && value > definition.max) {
      return { code: 'invalid_kwargs', message: `${definition.name} is above its maximum.` };
    }
  }
  return undefined;
}

/** Validate scope and declared kwargs before a binding invokes model code. */
export function validateActionInvocation(
  action: Action,
  payload: ActionInvokePayload,
): ValidatedActionInvocation {
  const scope = action.scope ?? 'model';
  if (scope === 'model' && payload.target !== undefined) {
    return error('invalid_target', `${action.id} only accepts model-scoped invocations.`);
  }
  if (scope !== 'model' && payload.target?.type !== scope) {
    return error('invalid_target', `${action.id} requires a ${scope} target.`);
  }

  const supplied = payload.kwargs ?? {};
  const definitions = action.kwargs ?? [];
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const name of Object.keys(supplied)) {
    if (!definitionsByName.has(name)) {
      return error('invalid_kwargs', `${action.id} does not declare the ${name} argument.`);
    }
  }

  const kwargs: Record<string, ProtocolValue> = {};
  for (const definition of definitions) {
    let value: ProtocolValue | undefined;
    if (hasOwn(supplied, definition.name)) {
      value = supplied[definition.name]!;
    } else if (hasOwn(definition, 'default')) {
      value = definition.default as ProtocolValue;
    } else if (definition.required) {
      return error('invalid_kwargs', `${definition.name} is required.`);
    } else {
      continue;
    }
    const invalid = validateKwargValue(definition, value);
    if (invalid) return { error: invalid };
    kwargs[definition.name] = value;
  }

  return {
    payload: {
      ...payload,
      ...(Object.keys(kwargs).length > 0 ? { kwargs } : {}),
    },
  };
}
