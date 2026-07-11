import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import type { BenchmarkCase } from '../types';

type CommitState = {
  revision: number;
};

/**
 * Measures the production-state update boundary: a Zustand update followed by
 * a synchronous React 19 DOM commit. It is deliberately a separate case from
 * canvas/model work, while the runner feeds it real RendererSession commits.
 */
export function createReactZustandCommitCase(): BenchmarkCase {
  const useCommitStore = create<CommitState>(() => ({ revision: 0 }));
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  let revision = 0;

  const CommitView = () => createElement(
    'output',
    { 'data-benchmark': 'zustand-react-commit' },
    String(useCommitStore((state) => state.revision)),
  );

  const commit = () => {
    revision += 1;
    flushSync(() => useCommitStore.setState({ revision }));
  };

  return {
    name: 'React/Zustand RendererSession commit',
    suite: 'synthetic',
    config: { react: '19', zustand: '5', commit: 'flushSync' },
    setup(container) {
      host = document.createElement('div');
      container.appendChild(host);
      root = createRoot(host);
      flushSync(() => root?.render(createElement(CommitView)));
    },
    tick() {},
    teardown() {
      root?.unmount();
      host?.remove();
      root = null;
      host = null;
      revision = 0;
      useCommitStore.setState({ revision: 0 });
    },
    runtime: {
      applySessionStep(session, frame) {
        session.handleIncoming({ type: 'metadata_update', payload: { benchmarkFrame: frame } });
      },
      onCommit: commit,
    },
  };
}
