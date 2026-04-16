import { useTransportStore } from "@/store/transport";
import { useScenarioStore } from '@/store/scenario/store';
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionEndPayload } from '@tensnap/core';
import { SimulationLoopController } from '@/store/simulation-loop';



export function useButtonControls() {
  const sendMessage = useTransportStore((state) => state.sendMessage);
  const createActionStartMessage = useScenarioStore((state) => state.createActionStartMessage);
  const actions = useScenarioStore((state) => state.actions);
  const scenario = useScenarioStore((state) => state.scenario);

  const loopControllerRef = useRef<SimulationLoopController | null>(null);
  const [runningActions, setRunningActions] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!sendMessage || !createActionStartMessage || !scenario) {
      return;
    }

    loopControllerRef.current?.dispose();
    loopControllerRef.current = new SimulationLoopController(sendMessage, createActionStartMessage);

    const handleActionEnd = (event: Event) => {
      const detail = (event as CustomEvent<ActionEndPayload>).detail;
      loopControllerRef.current?.handleActionEnd(detail);
      if (detail.continue === false) {
        setRunningActions((prev) => {
          const next = new Set(prev);
          next.delete(detail.id);
          return next;
        });
      }
    };

    scenario.addEventListener('action:end', handleActionEnd);

    return () => {
      scenario.removeEventListener('action:end', handleActionEnd);
      loopControllerRef.current?.dispose();
      loopControllerRef.current = null;
      setRunningActions(new Set());
    };
  }, [scenario, sendMessage, createActionStartMessage]);

  const handleButtonAction = useCallback(
    (action: string, continuous?: boolean) => {
      if (!sendMessage || !createActionStartMessage) {
        return;
      }

      const actionMeta = actions?.get(action);
      const isContinuous = continuous ?? actionMeta?.continuous ?? false;
      const loopController = loopControllerRef.current;

      if (isContinuous && loopController) {
        if (loopController.isRunning(action)) {
          loopController.stop(action);
          setRunningActions((prev) => {
            const next = new Set(prev);
            next.delete(action);
            return next;
          });
          return;
        }
        loopController.start(action);
        setRunningActions((prev) => new Set([...prev, action]));
        return;
      }

      if (loopController) {
        loopController.stop();
        setRunningActions(new Set());
      }

      sendMessage(createActionStartMessage(action, false));
    },
    [actions, createActionStartMessage, sendMessage]
  );

  const isRunning = useCallback(
    (id: string) => runningActions.has(id),
    [runningActions]
  );

  return {
    handleButtonAction,
    isRunning,
  };

}
