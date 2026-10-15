import { describe, expect, it } from 'vitest';
import { createDialogStore } from './zustand';

type Props = { open?: boolean; onOpenChange?: (open: boolean) => void; label?: string };
const Dialog = (_props: Props) => null;

describe('dialog requests', () => {
  it('cancels a superseded request and resolves the latest request once', async () => {
    const [store] = createDialogStore<Props, string | null>(Dialog, undefined, null);
    const first = store.getState().invoke({ label: 'first' });
    const second = store.getState().invoke({ label: 'second' });
    await expect(first).resolves.toBeNull();
    expect(store.getState().options?.label).toBe('second');
    store.getState().closeDialog('chosen');
    store.getState().closeDialog('ignored');
    await expect(second).resolves.toBe('chosen');
    expect(store.getState().open).toBe(false);
  });

  it('preserves explicit null results when the cancellation default is non-null', async () => {
    const [store] = createDialogStore<Props, string | null>(Dialog, undefined, 'cancelled');
    const result = store.getState().invoke();
    store.getState().closeDialog(null);
    await expect(result).resolves.toBeNull();
  });
});
