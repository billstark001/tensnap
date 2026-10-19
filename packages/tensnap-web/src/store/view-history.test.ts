import { describe, expect, it } from 'vitest';
import { createDefaultRootLayout } from '@tensnap/core/persistence';

import { createStore } from 'zustand/vanilla';
import { createHistoryState } from './history-model';
import { recordViewHistoryChange } from './view-history-model';

describe('view history metadata commands', () => {
  it('records and replays button metadata when the view tree itself is unchanged', async () => {
    const history = createStore(createHistoryState());
    const view = createDefaultRootLayout();
    const action: { label: string; role: 'run' | 'custom' } = { label: 'After', role: 'run' };

    recordViewHistoryChange(
      history.getState(),
      () => {},
      'Edit button view',
      'view-config',
      view,
      view,
      undefined,
      {
        byteSize: 32,
        apply: () => {
          Object.assign(action, { label: 'After', role: 'run' as const });
        },
        revert: () => {
          Object.assign(action, { label: 'Before', role: 'custom' as const });
        },
      },
    );

    expect(history.getState().past).toHaveLength(1);
    await history.getState().undo();
    expect(action).toEqual({ label: 'Before', role: 'custom' });
    await history.getState().redo();
    expect(action).toEqual({ label: 'After', role: 'run' });
  });
});
