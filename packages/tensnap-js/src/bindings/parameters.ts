import type { Parameter } from '@tensnap/protocol';
import type {
  BooleanParameterOptions,
  ConfigBooleanField,
  ConfigEnumField,
  ConfigNumberField,
  ConfigParamField,
  ConfigParamFieldMap,
  ConfigStringField,
  EnumParameterOptions,
  ModelSessionContext,
  NumberParameterOptions,
  ParameterBinding,
  ParamsFromConfigOptions,
  StringParameterOptions,
} from './types';
import { normalizeNumber, titleFromId, withDefined } from './utils';

function resolveParameterFactory<TConfig extends object, TModel, TValue>(
  value: TValue | ((model: TModel, config: TConfig) => TValue),
  model: TModel,
  config: TConfig,
): TValue {
  return typeof value === 'function'
    ? (value as (model: TModel, config: TConfig) => TValue)(model, config)
    : value;
}

export function numberParameter<TConfig extends object, TModel>(
  id: string,
  options: NumberParameterOptions<TConfig, TModel>,
): ParameterBinding<TConfig, TModel> {
  return {
    id,
    metadata(model, config) {
      return withDefined({
        id,
        type: 'number' as const,
        label: options.label ?? titleFromId(id),
        value: options.get(model, config),
        min: options.min,
        max: options.max,
        step: options.step,
        allow_runtime_change: options.runtime ?? true,
      }) as Parameter;
    },
    async apply(model, payload, ctx, config) {
      if (!options.set) {
        return { accepted: false };
      }
      const value = normalizeNumber(payload.value, {
        min: options.min,
        max: options.max,
        step: options.step,
        integer: options.integer,
        normalize: options.normalize
          ? (entry) => options.normalize!(entry, model, config)
          : undefined,
      });
      if (value === undefined) {
        return { accepted: false };
      }
      await options.set(model, value, ctx);
      return { accepted: true, value };
    },
  };
}

export function booleanParameter<TConfig extends object, TModel>(
  id: string,
  options: BooleanParameterOptions<TConfig, TModel>,
): ParameterBinding<TConfig, TModel> {
  return {
    id,
    metadata(model, config) {
      return {
        id,
        type: 'boolean',
        label: options.label ?? titleFromId(id),
        value: options.get(model, config),
        allow_runtime_change: options.runtime ?? true,
      };
    },
    async apply(model, payload, ctx) {
      if (!options.set || typeof payload.value !== 'boolean') {
        return { accepted: false };
      }
      await options.set(model, payload.value, ctx);
      return { accepted: true, value: payload.value };
    },
  };
}

export function stringParameter<TConfig extends object, TModel>(
  id: string,
  options: StringParameterOptions<TConfig, TModel>,
): ParameterBinding<TConfig, TModel> {
  return {
    id,
    metadata(model, config) {
      return {
        id,
        type: 'string',
        label: options.label ?? titleFromId(id),
        value: options.get(model, config),
        allow_runtime_change: options.runtime ?? true,
      };
    },
    async apply(model, payload, ctx) {
      if (!options.set) {
        return { accepted: false };
      }
      const value = String(payload.value ?? '');
      await options.set(model, value, ctx);
      return { accepted: true, value };
    },
  };
}

export function enumParameter<
  TConfig extends object,
  TModel,
  TValue extends string,
>(
  id: string,
  options: EnumParameterOptions<TConfig, TModel, TValue>,
): ParameterBinding<TConfig, TModel> {
  return {
    id,
    metadata(model, config) {
      const enumOptions = resolveParameterFactory(options.options, model, config);
      const labels = options.labels
        ? resolveParameterFactory(options.labels, model, config)
        : undefined;
      return withDefined({
        id,
        type: 'enum' as const,
        label: options.label ?? titleFromId(id),
        value: options.get(model, config),
        options: [...enumOptions],
        labels: labels ? { ...labels } : undefined,
        allow_runtime_change: options.runtime ?? true,
      }) as Parameter;
    },
    async apply(model, payload, ctx, config) {
      if (!options.set || typeof payload.value !== 'string') {
        return { accepted: false };
      }
      const enumOptions = resolveParameterFactory(options.options, model, config);
      if (!enumOptions.includes(payload.value as TValue)) {
        return { accepted: false };
      }
      await options.set(model, payload.value as TValue, ctx);
      return { accepted: true, value: payload.value };
    },
  };
}

export function createConfigParameter<TConfig extends object, TModel, TSource extends object>(
  key: keyof TSource & string,
  field: ConfigParamField,
  options: ParamsFromConfigOptions<TConfig, TModel, TSource>,
): ParameterBinding<TConfig, TModel> {
  const getter = (model: TModel, config: TConfig) => options.get(model, config)[key];
  const setter = options.set
    ? async (
      model: TModel,
      value: TSource[keyof TSource],
      ctx: ModelSessionContext<TConfig>,
    ) => {
      await options.set!(model, { [key]: value } as Partial<TSource>, key, value, ctx);
    }
    : undefined;

  switch (field.type) {
    case 'number':
      return numberParameter(key, {
        ...field,
        runtime: field.runtime ?? options.runtime,
        get: (model, config) => Number(getter(model, config)),
        set: setter
          ? (model, value, ctx) => setter(model, value as TSource[keyof TSource], ctx)
          : undefined,
        normalize: field.normalize
          ? (value) => field.normalize!(value)
          : undefined,
      });
    case 'boolean':
      return booleanParameter(key, {
        ...field,
        runtime: field.runtime ?? options.runtime,
        get: (model, config) => Boolean(getter(model, config)),
        set: setter
          ? (model, value, ctx) => setter(model, value as TSource[keyof TSource], ctx)
          : undefined,
      });
    case 'string':
      return stringParameter(key, {
        ...field,
        runtime: field.runtime ?? options.runtime,
        get: (model, config) => String(getter(model, config) ?? ''),
        set: setter
          ? (model, value, ctx) => setter(model, value as TSource[keyof TSource], ctx)
          : undefined,
      });
    case 'enum':
      return enumParameter(key, {
        ...field,
        runtime: field.runtime ?? options.runtime,
        get: (model, config) => String(getter(model, config) ?? field.options[0]) as string,
        set: setter
          ? (model, value, ctx) => setter(model, value as TSource[keyof TSource], ctx)
          : undefined,
      });
  }
}

export function inferConfigFields<TSource extends object>(source: TSource): ConfigParamFieldMap<TSource> {
  const fields: Record<string, ConfigParamField> = {};
  for (const [key, value] of Object.entries(source)) {
    switch (typeof value) {
      case 'number':
        fields[key] = { type: 'number' };
        break;
      case 'boolean':
        fields[key] = { type: 'boolean' };
        break;
      case 'string':
        fields[key] = { type: 'string' };
        break;
    }
  }
  return fields as ConfigParamFieldMap<TSource>;
}

export function numberField(options: Omit<ConfigNumberField, 'type'> = {}): ConfigNumberField {
  return { type: 'number', ...options };
}

export function booleanField(options: Omit<ConfigBooleanField, 'type'> = {}): ConfigBooleanField {
  return { type: 'boolean', ...options };
}

export function stringField(options: Omit<ConfigStringField, 'type'> = {}): ConfigStringField {
  return { type: 'string', ...options };
}

export function enumField<TValue extends string>(
  options: Omit<ConfigEnumField<TValue>, 'type'>,
): ConfigEnumField<TValue> {
  return { type: 'enum', ...options };
}
