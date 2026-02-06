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
    if (param.type === 'action') {
      log(`Cannot update value of action parameter ${id}.`, 'warning');
      return;
    }
    param.value = value;
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
});