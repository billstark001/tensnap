import { useScenarioStore } from '@/store/scenario/store';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/store/toast';
import type { ActionEndPayload } from '@tensnap/protocol';
import type { RunSpec } from '@tensnap/core/runtime';
import { useCallback, useEffect } from 'react';

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
  const setSimulatorMetrics = useSettingsStore((state) => state.setSimulatorMetrics);
  const clearRuntimeMetrics = useSettingsStore((state) => state.clearRuntimeMetrics);
  const toast = useToast();

  useEffect(() => {
    if (!scenario) {
      clearRuntimeMetrics();
      return;
    }

    const handleActionEnd = ((event: Event) => {
      const payload = (event as CustomEvent<ActionEndPayload>).detail;
      setSimulatorMetrics(payload?.timings);
    }) as EventListener;
    scenario.addEventListener('action:end', handleActionEnd);
    return () => scenario.removeEventListener('action:end', handleActionEnd);
  }, [scenario, setSimulatorMetrics, clearRuntimeMetrics]);

  useEffect(() => {
    if (!connected) clearRuntimeMetrics();
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
          session.run.start({ actionId: action, ...runSpec });
          return;
        }
        session.run.requestAction(action, false);
      } catch (error) {
        toast.error('Unable to run action', error instanceof Error ? error.message : String(error));
      }
    },
    [actions, connected, session, toast],
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
