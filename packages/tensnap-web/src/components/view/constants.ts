
export const SNAP_THRESHOLD = 8;
export const GRID_SIZE = 20;

export const MAIN_VIEW_PADDING = 400;

// Layout constants for view creation
export const ENVIRONMENT_GRID_WIDTH = 16;
export const ENVIRONMENT_CARD_WIDTH = 600;
export const ENVIRONMENT_CARD_HEIGHT = 600;

export const CHART_CARD_WIDTH = 500;
export const CHART_CARD_HEIGHT = 400;

export const MONITOR_CARD_WIDTH = 360;
export const MONITOR_CARD_HEIGHT = 260;

export const LAYOUT_PADDING = 10;

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

// 确保窗口增量是整数
export const WINDOW_X_DELTA = Math.ceil(viewConstants.windowBorderWidth * 2);
export const WINDOW_Y_DELTA = Math.ceil(viewConstants.windowBorderWidth + viewConstants.windowHeaderHeight);

export const PARAMETER_CARD_HEIGHT = 40 + WINDOW_Y_DELTA;

/**
 * Reserved view IDs that should not be used for user-created views
 */
export const preservedViewIds = Object.freeze({
  buttonsContainer: 'buttons-container',
  parametersContainer: 'parameters-container',
  mainContainer: 'main-container',
});
