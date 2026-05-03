import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { TextDecoder, TextEncoder } from 'util';

// Mock WebSocket
global.WebSocket = vi.fn().mockImplementation(() => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})) as any;

// Mock IndexedDB
const mockIDB = {
  open: vi.fn().mockResolvedValue({
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  }),
};

(global as any).indexedDB = mockIDB;

// Mock canvas
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
})) as any;

global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;