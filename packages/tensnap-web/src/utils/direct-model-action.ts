import type { Action } from '@tensnap/protocol';

/**
 * A renderer surface without a target picker or argument form may invoke only
 * model-scoped actions whose required arguments are already satisfiable.
 */
export function isDirectModelAction(action: Action | undefined): action is Action {
  return Boolean(
    action
      && (action.scope === undefined || action.scope === 'model')
      && !action.kwargs?.some((argument) => argument.required === true),
  );
}
