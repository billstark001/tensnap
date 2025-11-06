
export const SNAP_THRESHOLD = 8;
export const GRID_SIZE = 20;


const windowHeaderHeight = 40;
const windowBorderWidth = 2;
const windowTopDelta = windowHeaderHeight - windowBorderWidth;
const windowLeftDelta = windowBorderWidth;

export const viewConstants = {

  dragHandleContentDelta: 12,
  dragHandleMinHeight: 24,
  dragHandleMinWidth: 72,

  windowBorderWidth,
  windowBorderRadius: 8,

  windowHeaderHeight,

  windowLeftDelta,
  windowTopDelta,

} as const;