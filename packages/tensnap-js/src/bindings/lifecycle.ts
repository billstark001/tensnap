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
      allowRuntimeChange: true,
      continuous: true,
    },
    {
      id: 'step',
      label: labels.step ?? 'Step',
      allowRuntimeChange: true,
      continuous: false,
    },
    {
      id: 'reset',
      label: labels.reset ?? 'Reset',
      allowRuntimeChange: true,
      continuous: false,
    },
  );
}
