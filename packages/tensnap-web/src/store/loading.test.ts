import { describe, expect, it } from 'vitest';
import { useLoadingStore } from './loading';

describe('loading store', () => {
  it('keeps a shared process active until every overlapping operation finishes', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const firstWait = new Promise<void>((resolve) => { finishFirst = resolve; });
    const secondWait = new Promise<void>((resolve) => { finishSecond = resolve; });
    const first = useLoadingStore.getState().withLoading(() => firstWait, 'project');
    const second = useLoadingStore.getState().withLoading(() => secondWait, 'project');

    expect(useLoadingStore.getState().loading).toBe(true);
    finishFirst();
    await first;
    expect(useLoadingStore.getState().loading).toBe(true);
    expect(useLoadingStore.getState().loadingProcesses.get('project')).toBe(1);

    finishSecond();
    await second;
    expect(useLoadingStore.getState().loading).toBe(false);
  });

  it('keeps anonymous and named loading work independent', () => {
    const { startLoading, stopLoading } = useLoadingStore.getState();
    startLoading();
    startLoading('');
    stopLoading();
    expect(useLoadingStore.getState().loading).toBe(true);
    stopLoading('');
    expect(useLoadingStore.getState().loading).toBe(false);
  });
});
