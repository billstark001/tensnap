import { useScenarioStore } from '@/store/scenario/store';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/store/toast';
import type { ActionEndPayload, ActionStartPayload } from '@tensnap/protocol';
import type { BoundedRunSpec, RunStatus } from '@tensnap/core/runtime';
import type { RendererSessionOutboundDetail } from '@tensnap/core/runtime';
import { useCallback, useEffect, useRef } from 'react';
import { ActionRunMetrics } from './actionRunMetrics';

export function isActionVisiblyRunning(status: RunStatus | null | undefined, actionId: string): boolean {
  return status?.state === 'running'
    && !status.pauseRequested
    && status.spec.actionId === actionId;
}

/**
 * Browser host adapter for the shared RendererSession RunController. The
 * controller owns protocol queueing and stop conditions; this hook only maps
 * UI clicks and simulator metrics into React state.
 */
export function useButtonControls() {
  const actions = useScenarioStore((state) => state.actions);
  const scenario = useScenarioStore((state) => state.scenario);
  const session = useScenarioStore((state) => state.session);
  const connected = useScenarioStore((state) => state.connected);
  const actionRevision = useScenarioStore((state) => state.actionRevision);
  const runRevision = useScenarioStore((state) => state.runRevision);
  const actionTimeoutSeconds = useSettingsStore((state) => state.actionTimeoutSeconds);
  const setActionMetrics = useSettingsStore((state) => state.setActionMetrics);
  const clearRuntimeMetrics = useSettingsStore((state) => state.clearRuntimeMetrics);
  const toast = useToast();
  const metricsRunRef = useRef<ActionRunMetrics | null>(null);

  useEffect(() => {
    if (!scenario || !session) {
      metricsRunRef.current = null;
      clearRuntimeMetrics();
      return;
    }

    const handleActionEnd = ((event: Event) => {
      const payload = (event as CustomEvent<ActionEndPayload>).detail;
      const snapshot = metricsRunRef.current?.recordCompletion(payload);
      if (!snapshot) return;
      setActionMetrics(snapshot);
    }) as EventListener;
    const handleOutbound = ((event: Event) => {
      const { message } = (event as CustomEvent<RendererSessionOutboundDetail>).detail;
      if (message.type !== 'action_start') return;
      metricsRunRef.current?.recordDispatch(message.payload as ActionStartPayload);
    }) as EventListener;

    scenario.addEventListener('action:end', handleActionEnd);
    session.addEventListener('outbound', handleOutbound);
    return () => {
      scenario.removeEventListener('action:end', handleActionEnd);
      session.removeEventListener('outbound', handleOutbound);
    };
  }, [scenario, session, setActionMetrics, clearRuntimeMetrics]);

  useEffect(() => {
    if (connected) return;
    metricsRunRef.current = null;
    clearRuntimeMetrics();
  }, [connected, clearRuntimeMetrics]);

  useEffect(() => {
    if (!session) return;
    session.run.setActionTimeoutMs(actionTimeoutSeconds * 1000);
  }, [session, actionTimeoutSeconds]);

  const handleButtonAction = useCallback(
    (action: string, continuous?: boolean, runSpec?: Omit<BoundedRunSpec, 'actionId' | 'mode'>) => {
      if (!connected || !session) return;
      const actionMeta = actions?.get(action);
      const isContinuous = continuous ?? actionMeta?.continuous ?? false;

      const beginMetrics = () => {
        // Stopping keeps the last window visible. Only a new user action
        // replaces it, which also prevents two runs from sharing samples.
        metricsRunRef.current = new ActionRunMetrics(action);
        clearRuntimeMetrics();
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
        toast.error('Unable to run action', error instanceof Error ? error.message : String(error));
      }
    },
    [actions, clearRuntimeMetrics, connected, session, toast],
  );

  const startManualRun = useCallback((actionId: string) => {
    if (!connected || !session) return;
    try {
      metricsRunRef.current = new ActionRunMetrics(actionId);
      clearRuntimeMetrics();
      session.run.start({ mode: 'manual', actionId, record: false });
    } catch (error) {
      toast.error('Unable to run action', error instanceof Error ? error.message : String(error));
    }
  }, [clearRuntimeMetrics, connected, session, toast]);

  const startBoundedRun = useCallback((actionId: string, spec: Omit<BoundedRunSpec, 'actionId' | 'mode'>) => {
    if (!connected || !session) return;
    try {
      metricsRunRef.current = new ActionRunMetrics(actionId);
      clearRuntimeMetrics();
      session.run.start({ mode: 'bounded', actionId, ...spec });
    } catch (error) {
      toast.error('Unable to run action', error instanceof Error ? error.message : String(error));
    }
  }, [clearRuntimeMetrics, connected, session, toast]);

  const pauseRun = useCallback(() => session?.run.pause(), [session]);
  const requestStep = useCallback((actionId: string) => {
    if (!connected || !session) return;
    try {
      metricsRunRef.current = new ActionRunMetrics(actionId);
      clearRuntimeMetrics();
      session.run.requestStep(actionId);
    } catch (error) {
      toast.error('Unable to step', error instanceof Error ? error.message : String(error));
    }
  }, [clearRuntimeMetrics, connected, session, toast]);
  const requestReset = useCallback((actionId: string) => {
    if (!connected || !session) return;
    try {
      session.run.requestReset(actionId);
    } catch (error) {
      toast.error('Unable to reset', error instanceof Error ? error.message : String(error));
    }
  }, [connected, session, toast]);
  const requestModelAction = useCallback((actionId: string) => {
    if (!connected || !session) return;
    try {
      metricsRunRef.current = new ActionRunMetrics(actionId);
      clearRuntimeMetrics();
      session.run.requestAction(actionId, false);
    } catch (error) {
      toast.error('Unable to run model action', error instanceof Error ? error.message : String(error));
    }
  }, [clearRuntimeMetrics, connected, session, toast]);

  const runStatus: RunStatus | null = (() => {
    void actionRevision;
    void runRevision;
    return session?.run.status ?? null;
  })();

  const isRunning = useCallback(
    (id: string) => {
      void runRevision;
      const run = session?.run.status;
      return isActionVisiblyRunning(run, id);
    },
    [runRevision, session],
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
  };
}
