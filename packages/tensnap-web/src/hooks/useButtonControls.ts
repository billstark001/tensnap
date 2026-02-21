import { useWebSocketStore } from "@/store/websocket";
import { ActionStartPayload } from "@/types/api";
import { useCallback } from "react";



export function useButtonControls() {
  const sendMessage = useWebSocketStore((state) => state.sendMessage);

  const handleButtonAction = useCallback(
    (action: string, continuous?: boolean) => {
      sendMessage?.<ActionStartPayload>({
        type: 'action_start',
        payload: { id: action, ...(continuous !== undefined ? { continuous } : {}) },
      });
    },
    [sendMessage]
  );

  return {
    handleButtonAction
  };

}