import { useTransportStore } from "@/store/transport";
import { useScenarioStore } from '@/store/scenario/store';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/store/toast';
import type { ActionEndPayload } from '@tensnap/core';
import { useCallback, useEffect, useMemo, useState } from "react";
import { createIdleLoopState, SimulationLoopController } from '@tensnap/core/runtime/browser';

type ActionEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

const controllerCache = new WeakMap<ActionEventSource, SimulationLoopController>();


const getSimulationLoopController = (scenario: ActionEventSource): SimulationLoopController => {
  let controller = controllerCache.get(scenario);
  if (!controller) {
    controller = new SimulationLoopController(scenario);
    controllerCache.set(scenario, controller);
  }
  return controller;
};

export function useButtonControls() {
  const sendMessage = useTransportStore((state) => state.sendMessage);
  const createActionStartMessage = useScenarioStore((state) => state.createActionStartMessage);
  const actions = useScenarioStore((state) => state.actions);
  const scenario = useScenarioStore((state) => state.scenario);
  const connected = useScenarioStore((state) => state.connected);
  const stateSync = useScenarioStore((state) => state.stateSync);
  const renderTriggerMode = useSettingsStore((state) => state.renderTriggerMode);
  const maxTps = useSettingsStore((state) => state.maxTps);
  const maxRenderFps = useSettingsStore((state) => state.maxRenderFps);
  const actionTimeoutSeconds = useSettingsStore((state) => state.actionTimeoutSeconds);
  const setRuntimeMetrics = useSettingsStore((state) => state.setRuntimeMetrics);
  const setSimulatorMetrics = useSettingsStore((state) => state.setSimulatorMetrics);
  const clearRuntimeMetrics = useSettingsStore((state) => state.clearRuntimeMetrics);
  const toast = useToast();

  const loopController = useMemo(() => {
    if (!scenario) {
      return null;
    }
    return getSimulationLoopController(scenario);
  }, [scenario]);

  const idleLoopState = useMemo(() => createIdleLoopState(), []);
  const [loopState, setLoopState] = useState(idleLoopState);

  useEffect(() => {
    if (!loopController) {
      return;
    }

    const syncLoopState = () => {
      setLoopState(loopController.getState());
    };
    const release = loopController.retain();
    const unsubscribe = loopController.subscribe(syncLoopState);
    queueMicrotask(syncLoopState);

    return () => {
      unsubscribe();
      release();
    };
  }, [loopController]);

  const resolvedLoopState = loopController ? loopState : idleLoopState;

  useEffect(() => {
    loopController?.updateOptions({
      sendMessage,
      createActionStartMessage,
      mode: renderTriggerMode,
      maxTps,
      maxRenderFps,
      actionTimeoutMs: actionTimeoutSeconds * 1000,
      onMetricsChange: setRuntimeMetrics,
      onActionTimeout: ({ actionId, timeoutMs }) => {
        toast.error(
          'Action timed out',
          `No action_end received for "${actionId}" within ${timeoutMs / 1000}s.`,
        );
      },
    });
  }, [loopController, sendMessage, createActionStartMessage, renderTriggerMode, maxTps, maxRenderFps, actionTimeoutSeconds, setRuntimeMetrics, toast]);

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
    return () => {
      scenario.removeEventListener('action:end', handleActionEnd);
    };
  }, [scenario, setSimulatorMetrics, clearRuntimeMetrics]);

  useEffect(() => {
    if (connected) return;

    loopController?.reset();
    clearRuntimeMetrics();
  }, [connected, loopController, clearRuntimeMetrics]);

  useEffect(() => {
    if (!loopController || !stateSync) {
      return;
    }

    loopController.syncStateSync(stateSync);
    if (stateSync.phase !== 'idle') {
      clearRuntimeMetrics();
    }
  }, [loopController, stateSync, clearRuntimeMetrics]);

  const handleButtonAction = useCallback(
    (action: string, continuous?: boolean) => {
      if (!loopController?.canDispatch()) {
        return;
      }

      const actionMeta = actions?.get(action);
      const isContinuous = continuous ?? actionMeta?.continuous ?? false;

      loopController.requestAction(action, isContinuous);
    },
    [actions, loopController]
  );

  const isRunning = useCallback(
    (id: string) => resolvedLoopState.runningActions.has(id),
    [resolvedLoopState.runningActions]
  );

  return {
    handleButtonAction,
    isRunning,
  };

}
