// Mock leafer-ui for Vitest test environment (no canvas required)
const noop = () => {};
const mockClass = class {
  constructor(..._args: any[]) {}
  on = noop;
  off = noop;
  add = noop;
  remove = noop;
  destroy = noop;
  resize = noop;
  set = noop;
  get = noop;
};

export const Leafer = mockClass;
export const App = mockClass;
export const Line = mockClass;
export const Text = mockClass;
export const Group = mockClass;
export const Rect = mockClass;
export const Ellipse = mockClass;
export const Image = mockClass;
export const Path = mockClass;
export const Box = mockClass;
export const Frame = mockClass;
export const UI = mockClass;
export const LeafHelper = {};
export const DragEvent = {};
export const PointerEvent = {};
export const ResizeEvent = {};
export const ZoomEvent = {};
export const MoveEvent = {};

export default {};
