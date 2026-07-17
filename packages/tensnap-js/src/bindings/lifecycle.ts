import type { Action } from '@tensnap/protocol';
import { defineActions } from './define';
import type { LifecycleActionLabels } from './types';

export function defineLifecycleActions(
  labels: LifecycleActionLabels = {},
): readonly Action[] {
  return defineActions(
    {
      id: 'start',
      label: labels.start ?? 'Start',
      continuous: true,
    },
    {
      id: 'step',
      label: labels.step ?? 'Step',
      continuous: false,
    },
    {
      id: 'stop',
      label: labels.stop ?? 'Stop',
      continuous: false,
    },
    {
      id: 'reset',
      label: labels.reset ?? 'Reset',
      continuous: false,
    },
  );
}
