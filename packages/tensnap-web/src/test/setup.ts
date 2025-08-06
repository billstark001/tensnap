import '@testing-library/jest-dom';

// Mock WebSocket
global.WebSocket = jest.fn().mockImplementation(() => ({
  send: jest.fn(),
  close: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
})) as any;

// Mock IndexedDB
const mockIDB = {
  open: jest.fn().mockResolvedValue({
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  }),
};

(global as any).indexedDB = mockIDB;

// Mock canvas
HTMLCanvasElement.prototype.getContext = jest.fn().mockImplementation(() => ({
  clearRect: jest.fn(),
  fillRect: jest.fn(),
  strokeRect: jest.fn(),
  fillText: jest.fn(),
  strokeText: jest.fn(),
  beginPath: jest.fn(),
  closePath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  arc: jest.fn(),
  fill: jest.fn(),
  stroke: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  translate: jest.fn(),
  rotate: jest.fn(),
  scale: jest.fn(),
})) as any;

global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;