import type { Action, ChartGroup, Parameter, ParameterType } from '@/types/model';
import type { AnchoredView, AnyView, ButtonView } from '@/types/ui';
import type { EditableEnvironmentData } from './environment-editor-model';
import { getEditableEnvironmentData } from './environment-editor-model';

export type EditableObjectKind = 'button' | 'parameter' | 'environment' | 'chart';
export type EditableObjectData = Action | Parameter | EditableEnvironmentData | ChartGroup | null;

export type ScenarioDataSources = {
  actions?: ReadonlyMap<string, Action>;
  parameters?: ReadonlyMap<string, Parameter>;
  environments?: Parameters<typeof getEditableEnvironmentData>[0];
  charts?: {
    getGroup(id: string): ChartGroup | undefined;
    hasGroup?(id: string): boolean;
  };
};

export const editableObjectKinds = new Set<AnyView['type']>([
  'button',
  'parameter',
  'environment',
  'chart',
]);

export const getEditableObjectKind = (view: AnyView): EditableObjectKind | null => (
  editableObjectKinds.has(view.type) ? view.type as EditableObjectKind : null
);

export const getBoundObjectId = (view: AnyView): string => {
  if (!getEditableObjectKind(view)) {
    return '';
  }
  return String((view as ButtonView | AnchoredView).data?.id ?? '');
};

export const withBoundObjectId = (view: AnyView, id: string): AnyView => {
  const updated = {
    ...view,
    data: view.data ? structuredClone(view.data) : view.data,
  } as AnyView;

  if (getEditableObjectKind(updated) && updated.data) {
    (updated.data as { id?: string }).id = id;
  }

  return updated;
};

export const getEditableObjectData = (view: AnyView, sources: ScenarioDataSources): EditableObjectData => {
  const id = getBoundObjectId(view);

  switch (view.type) {
    case 'button': {
      const action = sources.actions?.get(id);
      return action ? structuredClone(action) : null;
    }
    case 'parameter': {
      const parameter = sources.parameters?.get(id);
      return parameter ? structuredClone(parameter) : null;
    }
    case 'environment':
      return getEditableEnvironmentData(sources.environments, id);
    case 'chart': {
      const chart = sources.charts?.getGroup(id);
      return chart
        ? {
          ...chart,
          metadataDict: structuredClone(chart.metadataDict),
          data: chart.data,
        }
        : null;
    }
    default:
      return null;
  }
};

export const hasObjectId = (
  kind: EditableObjectKind,
  id: string,
  sources: ScenarioDataSources,
): boolean => {
  switch (kind) {
    case 'button':
      return sources.actions?.has(id) ?? false;
    case 'parameter':
      return sources.parameters?.has(id) ?? false;
    case 'environment':
      return sources.environments?.has(id) ?? false;
    case 'chart':
      return sources.charts?.hasGroup?.(id) ?? Boolean(sources.charts?.getGroup(id));
    default:
      return false;
  }
};

export const getObjectIdConflict = (
  kind: EditableObjectKind,
  currentId: string,
  nextId: string,
  objectExists: boolean,
  sources: ScenarioDataSources,
): boolean => {
  if (!objectExists || currentId === nextId) {
    return false;
  }
  return hasObjectId(kind, nextId, sources);
};

export const withObjectDataId = (
  objectData: EditableObjectData,
  id: string,
): EditableObjectData => (
  objectData ? ({ ...objectData, id } as EditableObjectData) : null
);

const toFiniteNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

export const normalizeParameterForType = (
  parameter: Parameter,
  nextType: ParameterType,
): Parameter => {
  const next = { ...parameter, type: nextType } as Parameter & Record<string, unknown>;

  switch (nextType) {
    case 'number': {
      const value = toFiniteNumber(next.value, 0);
      next.value = value;
      next.min = toFiniteNumber(next.min, Math.min(0, value));
      next.max = toFiniteNumber(next.max, Math.max(100, value));
      if ((next.min as number) >= (next.max as number)) {
        next.min = Math.min(0, value);
        next.max = Math.max(100, value + 1);
      }
      next.step = Math.max(Number.EPSILON, toFiniteNumber(next.step, 1));
      return next as Parameter;
    }
    case 'enum': {
      const options = Array.isArray(next.options)
        ? next.options.filter((option): option is string => typeof option === 'string')
        : [];
      const value = typeof next.value === 'string'
        ? next.value
        : options[0] ?? '';
      next.value = value;
      next.options = value && !options.includes(value) ? [...options, value] : options;
      if (next.labels == null || typeof next.labels !== 'object' || Array.isArray(next.labels)) {
        next.labels = {};
      }
      return next as Parameter;
    }
    case 'boolean': {
      const value = next.value;
      next.value = typeof value === 'boolean'
        ? value
        : !(value === 'false' || value === 'False' || value === '' || value == null);
      return next as Parameter;
    }
    case 'string':
      next.value = next.value == null ? '' : String(next.value);
      return next as Parameter;
    default:
      return next as Parameter;
  }
};

export const normalizeEnvironmentForType = (
  environment: EditableEnvironmentData,
  nextType: EditableEnvironmentData['type'],
): EditableEnvironmentData => ({
  ...environment,
  type: nextType,
  displayType: nextType,
});
