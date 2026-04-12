import { useTransportStore } from "@/store/transport";
import { useScenarioStore } from '@/store/scenario/store';
import { useCallback } from "react";



export function useButtonControls() {
  const sendMessage = useTransportStore((state) => state.sendMessage);
  const createActionStartMessage = useScenarioStore((state) => state.createActionStartMessage);

  const handleButtonAction = useCallback(
    (action: string, continuous?: boolean) => {
      if (!sendMessage || !createActionStartMessage) {
        return;
      }
      sendMessage?.(createActionStartMessage(action, continuous));
    },
    [createActionStartMessage, sendMessage]
  );

  return {
    handleButtonAction
  };

}