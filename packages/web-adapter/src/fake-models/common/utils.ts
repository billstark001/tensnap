/**
 * Helper functions for creating fake WebSocket simulations
 */

import type { FakeWebSocketOptions } from './types';
import type { BaseSimulationManager } from './base-simulation';

/**
 * Create FakeWebSocketOptions from a simulation manager
 */
export function createFakeWebSocketOptions(
  manager: BaseSimulationManager
): FakeWebSocketOptions {
  return {
    metadata: manager.getMetadata(),
    
    onMessage: (message) => {
      manager.handleMessage(message);
    },
    
    onSendMessageFuncReady: async (sendFunc, wsManager) => {
      await manager.onReady(sendFunc, wsManager);
    },
    
    connectDelay: 10,
  };
}
