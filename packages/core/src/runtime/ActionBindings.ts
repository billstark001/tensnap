import type { Action } from '@tensnap/protocol';

export type ControlActionRole = 'run' | 'step' | 'reset' | 'stop';

export interface ActionBindingResolution {
  bindings: Partial<Record<ControlActionRole, string>>;
  errors: Partial<Record<ControlActionRole, string>>;
}

/**
 * Resolves legacy UI control intent in one place. A protocol-aware branch can
 * layer explicit semantic roles over this id/continuous convention.
 */
export function resolveActionBindings(actions: Iterable<Action>): ActionBindingResolution {
  const list = [...actions];
  const bindings: ActionBindingResolution['bindings'] = {};
  const errors: ActionBindingResolution['errors'] = {};

  const fallback = (role: ControlActionRole, predicate: (action: Action) => boolean) => {
    const matches = list.filter(predicate);
    if (matches.length === 1) bindings[role] = matches[0].id;
    else if (matches.length > 1) errors[role] = `Multiple legacy actions match the ${role} control: ${matches.map((action) => action.id).join(', ')}.`;
  };

  fallback('run', (action) => action.id === 'start');
  if (!bindings.run && !errors.run) {
    fallback('run', (action) => action.continuous === true);
  }
  fallback('step', (action) => action.id === 'step');
  fallback('reset', (action) => action.id === 'reset');
  fallback('stop', (action) => action.id === 'stop');

  return { bindings, errors };
}
