
// Custom exception classes for better error handling
export class WebSocketError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'WebSocketError';
  }
}

export class WebSocketConnectionError extends WebSocketError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR');
    this.name = 'WebSocketConnectionError';
  }
}

export class WebSocketDestroyedError extends WebSocketError {
  constructor() {
    super('WebSocketManager has been destroyed', 'DESTROYED');
    this.name = 'WebSocketDestroyedError';
  }
}

export class WebSocketAbortedError extends WebSocketError {
  constructor() {
    super('Connection aborted', 'ABORTED');
    this.name = 'WebSocketAbortedError';
  }
}
