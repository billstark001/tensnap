import { useWebSocketStore } from "@/store/websocket";
import { ButtonClickPayload } from "@/types/api";
import { useCallback } from "react";



export function useButtonControls() {
  const sendMessage = useWebSocketStore((state) => state.sendMessage);

  const handleButtonAction = useCallback(
    (action: string) => {
      sendMessage?.<ButtonClickPayload>({
        type: 'button_click',
        payload: { action: action },
      });
    },
    [sendMessage]
  );

  return {
    handleButtonAction
  };

}