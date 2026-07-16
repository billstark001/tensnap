import type { Action } from '@tensnap/protocol';
import { isDirectModelAction } from '@/utils/direct-model-action';

/** Resolve the direct, argument-free actions supported by fixed toolbar controls. */
export function resolveToolbarActionIds(actions: ReadonlyMap<string, Action> | undefined) {
  const action = (id: string) => actions?.get(id);
  const start = action('start');
  const step = action('step');
  const reset = action('reset');
  return {
    // The minimal profile has only continuous `step`; it is valid for both run
    // and one-shot controls when no explicit start action is callable.
    runActionId: isDirectModelAction(start) ? 'start' : isDirectModelAction(step) ? 'step' : undefined,
    stepActionId: isDirectModelAction(step) ? 'step' : undefined,
    resetActionId: isDirectModelAction(reset) ? 'reset' : undefined,
  };
}
