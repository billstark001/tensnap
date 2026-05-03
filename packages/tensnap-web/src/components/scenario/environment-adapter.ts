import type { ScenarioEnvironmentSnapshot, ScenarioEnvironmentState } from '@tensnap/core';

type AnyEnvironment = Pick<ScenarioEnvironmentState, 'type'> | Pick<ScenarioEnvironmentSnapshot, 'type'>;

export const getEnvironmentDisplayType = (environment: AnyEnvironment): ScenarioEnvironmentState['type'] => {
  return environment.type;
};
