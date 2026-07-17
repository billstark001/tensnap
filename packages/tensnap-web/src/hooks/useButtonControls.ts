import { useScenarioStore } from '@/store/scenario/store';
import { useProjectStore } from '@/store/project';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/store/toast';
import type { BoundedRunSpec, RunStatus } from '@tensnap/core/runtime';
import { useCallback, useEffect, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

export function isActionVisiblyRunning(status: RunStatus | null | undefined, actionId: string): boolean {
  return status?.state === 'running'
    && !status.pauseRequested
    && status.spec.actionId === actionId;
}

/**
 * Browser host adapter for the shared RendererSession RunController. The
 * controller owns protocol queueing, stop conditions, and run metrics; this
 * hook maps UI clicks and snapshot playback into React state.
 */
export function useButtonControls() {
  const { _ } = useLingui();
  const actions = useScenarioStore((state) => state.actions);
  const session = useScenarioStore((state) => state.session);
  const connected = useScenarioStore((state) => state.connected);
  const actionRevision = useScenarioStore((state) => state.actionRevision);
  const runRevision = useScenarioStore((state) => state.runRevision);
  const loadScenario = useScenarioStore((state) => state.load);
  const activeProject = useProjectStore((state) => state.activeProject);
  const actionTimeoutSeconds = useSettingsStore((state) => state.actionTimeoutSeconds);
  const snapshotPlaybackFps = useSettingsStore((state) => state.snapshotPlaybackFps);
  const toast = useToast();
  const snapshotPlayback = activeProject?.source.kind === 'snapshot' ? activeProject.snapshotPlayback : undefined;
  // Associate play state with the exact playback object. A source replacement
  // then becomes stopped by derivation, without a cascading reset effect.
  const [playingSnapshot, setPlayingSnapshot] = useState<typeof snapshotPlayback>(undefined);
  const snapshotPlaying = playingSnapshot === snapshotPlayback && Boolean(snapshotPlayback);
  const isSnapshotSource = Boolean(snapshotPlayback);

  /** Full materialization is reserved for source load and explicit rewind. */
  const loadSnapshotScenario = useCallback(() => {
    if (snapshotPlayback) loadScenario?.(snapshotPlayback.scenario.dump());
  }, [loadScenario, snapshotPlayback]);

  /** The playback hot path applies only the newly recorded protocol messages. */
  const replaySnapshotFrame = useCallback(() => {
    if (!snapshotPlayback || !session) return false;
    const frame = snapshotPlayback.stepFrame();
    if (!frame) return false;
    session.applyReplayFrame(frame);
    return true;
  }, [session, snapshotPlayback]);

  useEffect(() => {
    if (!snapshotPlaying || !snapshotPlayback) return;
    const timer = window.setInterval(() => {
      if (!replaySnapshotFrame()) {
        snapshotPlayback.stop();
        setPlayingSnapshot(undefined);
      }
    }, 1000 / snapshotPlaybackFps);
    return () => window.clearInterval(timer);
  }, [replaySnapshotFrame, snapshotPlayback, snapshotPlaying, snapshotPlaybackFps]);

  const runSnapshotAction = useCallback((action: string) => {
    if (!snapshotPlayback) return false;
    if (action === 'start') {
      if (snapshotPlaying) {
        snapshotPlayback.stop();
        setPlayingSnapshot(undefined);
      } else {
        snapshotPlayback.start();
        setPlayingSnapshot(snapshotPlayback);
      }
      return true;
    }
    if (action === 'stop') {
      snapshotPlayback.stop();
      setPlayingSnapshot(undefined);
      return true;
    }
    if (action === 'step') {
      snapshotPlayback.stop();
      setPlayingSnapshot(undefined);
      replaySnapshotFrame();
      return true;
    }
    if (action === 'reset') {
      snapshotPlayback.reset();
      setPlayingSnapshot(undefined);
      loadSnapshotScenario();
      return true;
    }
    return false;
  }, [loadSnapshotScenario, replaySnapshotFrame, snapshotPlayback, snapshotPlaying]);

  useEffect(() => {
    if (!session) return;
    session.run.setActionTimeoutMs(actionTimeoutSeconds * 1000);
  }, [session, actionTimeoutSeconds]);

  const handleButtonAction = useCallback(
    (action: string, continuous?: boolean, runSpec?: Omit<BoundedRunSpec, 'actionId' | 'mode'>) => {
      if (isSnapshotSource) {
        if (!runSnapshotAction(action)) toast.warning(_(msg`Snapshot playback`), _(msg`Only start, step, stop, and reset are available for a snapshot source.`));
        return;
      }
      if (!connected || !session) return;
      const actionMeta = actions?.get(action);
      const isContinuous = continuous ?? actionMeta?.continuous ?? false;

      const beginMetrics = () => {
        // Stopping keeps the last window visible. Only a new user action
        // replaces it, which also prevents two runs from sharing samples.
        session.beginActionMetrics(action);
      };

      try {
        if (isContinuous) {
          const current = session.run.status;
          if (current?.state === 'running' && current.spec.actionId === action) {
            session.run.pause();
            return;
          }
          beginMetrics();
          session.run.start(runSpec
            ? { actionId: action, ...runSpec, mode: 'bounded' }
            : { actionId: action, mode: 'manual', record: false });
          return;
        }
        beginMetrics();
        session.run.requestAction(action, false);
      } catch (error) {
        toast.error(_(msg`Unable to run action`), error instanceof Error ? error.message : String(error));
      }
    },
    [_, actions, connected, isSnapshotSource, runSnapshotAction, session, toast],
  );

  const startManualRun = useCallback((actionId: string) => {
    if (isSnapshotSource) {
      runSnapshotAction(actionId === 'start' ? 'start' : actionId);
      return;
    }
    if (!connected || !session) return;
    try {
      session.beginActionMetrics(actionId);
      session.run.start({ mode: 'manual', actionId, record: false });
    } catch (error) {
      toast.error(_(msg`Unable to run action`), error instanceof Error ? error.message : String(error));
    }
  }, [_, connected, isSnapshotSource, runSnapshotAction, session, toast]);

  const startBoundedRun = useCallback((actionId: string, spec: Omit<BoundedRunSpec, 'actionId' | 'mode'>) => {
    if (isSnapshotSource) {
      runSnapshotAction(actionId === 'start' ? 'start' : actionId);
      return;
    }
    if (!connected || !session) return;
    try {
      session.beginActionMetrics(actionId);
      session.run.start({ mode: 'bounded', actionId, ...spec });
    } catch (error) {
      toast.error(_(msg`Unable to run action`), error instanceof Error ? error.message : String(error));
    }
  }, [_, connected, isSnapshotSource, runSnapshotAction, session, toast]);

  const pauseRun = useCallback(() => {
    if (isSnapshotSource) runSnapshotAction('stop');
    else session?.run.pause();
  }, [isSnapshotSource, runSnapshotAction, session]);
  const requestStep = useCallback((actionId: string) => {
    if (isSnapshotSource) {
      runSnapshotAction('step');
      return;
    }
    if (!connected || !session) return;
    try {
      session.beginActionMetrics(actionId);
      session.run.requestStep(actionId);
    } catch (error) {
      toast.error(_(msg`Unable to step`), error instanceof Error ? error.message : String(error));
    }
  }, [_, connected, isSnapshotSource, runSnapshotAction, session, toast]);
  const requestReset = useCallback((actionId: string) => {
    if (isSnapshotSource) {
      runSnapshotAction('reset');
      return;
    }
    if (!connected || !session) return;
    try {
      session.beginActionMetrics(actionId);
      session.run.requestReset(actionId);
    } catch (error) {
      toast.error(_(msg`Unable to reset`), error instanceof Error ? error.message : String(error));
    }
  }, [_, connected, isSnapshotSource, runSnapshotAction, session, toast]);
  const requestModelAction = useCallback((actionId: string) => {
    if (isSnapshotSource) {
      if (!runSnapshotAction(actionId)) toast.warning(_(msg`Snapshot playback`), _(msg`Custom simulator actions are unavailable for a snapshot source.`));
      return;
    }
    if (!connected || !session) return;
    try {
      session.beginActionMetrics(actionId);
      session.run.requestAction(actionId, false);
    } catch (error) {
      toast.error(_(msg`Unable to run model action`), error instanceof Error ? error.message : String(error));
    }
  }, [_, connected, isSnapshotSource, runSnapshotAction, session, toast]);

  const runStatus: RunStatus | null = (() => {
    void actionRevision;
    void runRevision;
    return session?.run.status ?? null;
  })();

  const isRunning = useCallback(
    (id: string) => {
      if (isSnapshotSource) return id === 'start' && snapshotPlaying;
      void runRevision;
      const run = session?.run.status;
      return isActionVisiblyRunning(run, id);
    },
    [isSnapshotSource, runRevision, session, snapshotPlaying],
  );

  return {
    handleButtonAction,
    isRunning,
    runStatus,
    startManualRun,
    startBoundedRun,
    pauseRun,
    requestStep,
    requestReset,
    requestModelAction,
    isSnapshotSource,
    isSnapshotPlaying: snapshotPlaying,
  };
}
