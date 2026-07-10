import { useScenarioStore } from '@/store/scenario/store';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/store/toast';
import type { ActionEndPayload, ActionStartPayload } from '@tensnap/protocol';
import type { RunSpec } from '@tensnap/core/runtime';
import type { RendererSessionOutboundDetail } from '@tensnap/core/runtime';
import { useCallback, useEffect, useRef } from 'react';
import { ActionRunMetrics } from './actionRunMetrics';

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
  const revision = useScenarioStore((state) => state._revision);
  const actionTimeoutSeconds = useSettingsStore((state) => state.actionTimeoutSeconds);
  const setRuntimeMetrics = useSettingsStore((state) => state.setRuntimeMetrics);
  const setSimulatorMetrics = useSettingsStore((state) => state.setSimulatorMetrics);
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
      setRuntimeMetrics(snapshot.runtime);
      setSimulatorMetrics(snapshot.simulator);
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
  }, [scenario, session, setRuntimeMetrics, setSimulatorMetrics, clearRuntimeMetrics]);

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
    (action: string, continuous?: boolean, runSpec?: Omit<RunSpec, 'actionId'>) => {
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
            session.run.stop();
            return;
          }
          if (!runSpec) {
            toast.warning('Run profile required', 'Choose a maximum step count before starting a continuous run.');
            return;
          }
          beginMetrics();
          session.run.start({ actionId: action, ...runSpec });
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

  const isRunning = useCallback(
    (id: string) => {
      // A protocol commit increments revision after every action_end, which
      // makes status updates observable without a second runtime store.
      void revision;
      const run = session?.run.status;
      return run?.state === 'running' && run.spec.actionId === id;
    },
    [revision, session],
  );

  return { handleButtonAction, isRunning };
}
