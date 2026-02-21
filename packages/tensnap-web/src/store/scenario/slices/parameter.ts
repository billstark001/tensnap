import { CreateStoreFunction } from '@/utils/zustand';
import { ParametersSlice, ScenarioStore } from '../types';

export const createParametersSlice: CreateStoreFunction<ParametersSlice, ScenarioStore> = (_, get) => ({
  parameters: new Map(),

  updateParameterValue: (id, value) => {
    const { parameters, log, parameterUpdateTrigger: { set } } = get();
    const param = parameters.get(id);
    if (!param) {
      log(`Parameter with id ${id} not found.`, 'warning');
      return;
    }
    // All Parameter variants in v0.2 have a value property
    (param as { value: any }).value = value;
    set();
  },

  updateParameterProps: (id, propsUpdate) => {
    const { parameters, log, parameterUpdateTrigger: { set } } = get();
    const param = parameters.get(id);
    if (!param) {
      log(`Parameter with id ${id} not found.`, 'warning');
      return;
    }
    Object.assign(param, propsUpdate);
    parameters.set(id, param);
    set();
  },

  renameParameter: (id, newId) => {
    const { parameters, log, parameterUpdateTrigger: { set } } = get();
    const param = parameters.get(id);
    if (!param) {
      log(`Parameter with id ${id} not found.`, 'warning');
      return;
    }
    if (parameters.has(newId)) {
      log(`Parameter with id ${newId} already exists.`, 'warning');
      return;
    }
    param.id = newId;
    parameters.delete(id);
    parameters.set(newId, param);
    set();
  },

  /** Create or fully replace a parameter. */
  upsertParameter: (param) => {
    const { parameters, parameterUpdateTrigger: { set } } = get();
    parameters.set(param.id, { ...param });
    set();
  },

  /** Remove a parameter. */
  deleteParameter: (id) => {
    const { parameters, log, parameterUpdateTrigger: { set } } = get();
    if (!parameters.has(id)) {
      log(`Parameter with id ${id} not found.`, 'warning');
      return;
    }
    parameters.delete(id);
    set();
  },

  /** Server-initiated value correction. */
  syncParameterValue: (id, value) => {
    get().updateParameterValue(id, value);
  },
});