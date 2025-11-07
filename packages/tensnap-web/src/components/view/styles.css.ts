import { style, styleVariants, keyframes } from '@vanilla-extract/css';
import { viewConstants } from './constants';

const fadeIn = keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const container = style({
  minWidth: '100px',
  minHeight: '100px',
  backgroundColor: '#f3f4f6',
  overflow: 'auto',
  position: 'relative',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: '#1a1a1a',
    },
  },
});

export const rootView = style({
  position: 'relative',
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  overflow: 'hidden',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: '#2a2a2a',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
    },
  },
});

export const draggableView = style({
  position: 'absolute',
  userSelect: 'none',
  transition: 'box-shadow 0.2s',
  ':hover': {
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  },
});

export const draggingView = style({
  opacity: 0.5,
  zIndex: 999,
});

export const dragHandle = style({
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  height: '24px',
  cursor: 'move',
  backgroundColor: 'transparent',
  transition: 'background-color 0.2s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
  borderTopLeftRadius: `${viewConstants.windowBorderRadius}px`,
  borderTopRightRadius: `${viewConstants.windowBorderRadius}px`,
  ':hover': {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
});

export const dragIcon = style({
  width: '16px',
  height: '16px',
  color: '#6b7280',
  opacity: 0,
  transition: 'opacity 0.2s',
  selectors: {
    [`${dragHandle}:hover &`]: {
      opacity: 1,
    },
  },
});

export const resizeHandle = styleVariants({
  se: {
    position: 'absolute',
    bottom: '-4px',
    right: '-4px',
    width: '12px',
    height: '12px',
    cursor: 'se-resize',
    backgroundColor: '#3b82f6',
    borderRadius: '2px',
    opacity: 0,
    transition: 'opacity 0.2s',
    zIndex: 10,
    selectors: {
      [`${draggableView}:hover &`]: {
        opacity: 1,
      },
    },
  },
  e: {
    position: 'absolute',
    top: '50%',
    right: '-4px',
    width: '8px',
    height: '40px',
    transform: 'translateY(-50%)',
    cursor: 'e-resize',
    backgroundColor: '#3b82f6',
    borderRadius: '2px',
    opacity: 0,
    transition: 'opacity 0.2s',
    zIndex: 10,
    selectors: {
      [`${draggableView}:hover &`]: {
        opacity: 0.7,
      },
    },
  },
  s: {
    position: 'absolute',
    bottom: '-4px',
    left: '50%',
    width: '40px',
    height: '8px',
    transform: 'translateX(-50%)',
    cursor: 's-resize',
    backgroundColor: '#3b82f6',
    borderRadius: '2px',
    opacity: 0,
    transition: 'opacity 0.2s',
    zIndex: 10,
    selectors: {
      [`${draggableView}:hover &`]: {
        opacity: 0.7,
      },
    },
  },
});

export const buttonView = style({
  backgroundColor: '#3b82f6',
  color: 'white',
  borderRadius: '6px',
  padding: '8px',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
  ':hover': {
    backgroundColor: '#2563eb',
  },
});

export const windowView = style({
  backgroundColor: 'white',
  border: `${viewConstants.windowBorderWidth}px solid #d6d8deff`,
  borderRadius: `${viewConstants.windowBorderRadius}px`,
  boxSizing: 'border-box',
  boxShadow: '0 0 10px 0 rgba(0, 0, 0, 0.1)',
  height: '100%',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: '#2a2a2a',
      borderColor: 'rgba(255, 255, 255, 0.2)',
      boxShadow: '0 0 10px 0 rgba(0, 0, 0, 0.3)',
    },

    [`${draggingView} &`]: {
      border: `${viewConstants.windowBorderWidth}px dashed #3b82f6`,
    }
  },
});

export const windowViewHeader = style({
  backgroundColor: '#f9fafb',
  padding: '6px 8px',
  borderBottom: '1px solid #e5e7eb',
  borderTopLeftRadius: `${viewConstants.windowBorderRadius - viewConstants.windowBorderWidth}px`,
  borderTopRightRadius: `${viewConstants.windowBorderRadius - viewConstants.windowBorderWidth}px`,
  height: `${viewConstants.windowHeaderHeight - viewConstants.windowBorderWidth * 2}px`,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: '#3a3a3a',
      borderBottomColor: 'rgba(255, 255, 255, 0.2)',
    },
  },
});

export const windowViewContent = style({
  position: 'relative',
  flex: 1,
  overflow: 'hidden',
  selectors: {
    [`${rootView} &`]: {
      height: '100%',
    }
  }
});


export const containerViewDragOver = style({
  borderColor: '#3b82f6',
  backgroundColor: '#eff6ff',
});

export const expandButton = style({
  background: 'none',
  border: 'none',
  padding: '0',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  color: '#4b5563',
});

export const alignmentGuide = style({
  position: 'absolute',
  backgroundColor: '#ef4444',
  zIndex: 1000,
  pointerEvents: 'none',
  animation: `${fadeIn} 0.1s ease-in`,
});

export const horizontalGuide = style([
  alignmentGuide,
  {
    height: '1px',
    left: 0,
    right: 0,
  },
]);

export const verticalGuide = style([
  alignmentGuide,
  {
    width: '1px',
    top: 0,
    bottom: 0,
  },
]);

export const contextMenu = style({
  backgroundColor: 'white',
  borderRadius: '6px',
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  padding: '4px',
  minWidth: '160px',
  border: '1px solid #e5e7eb',
});

export const contextMenuItem = style({
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  fontSize: '14px',
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  ':hover': {
    backgroundColor: '#f3f4f6',
  },
});

export const contextMenuItemDanger = style([
  contextMenuItem,
  {
    color: '#dc2626',
  },
]);

export const contextMenuLabel = style({
  padding: '8px 12px',
  fontSize: '12px',
  color: '#6b7280',
});

export const dragOverlayAnchor = style({
  position: 'absolute',
  backgroundColor: 'rgba(83, 206, 255, 0.34)',
  top: 0,
  left: 0,
  minWidth: `${viewConstants.dragHandleMinWidth}px`,
  minHeight: `${viewConstants.dragHandleMinHeight}px`,
  borderRadius: `${viewConstants.windowBorderRadius}px`,
});

export const dragOverlay = style({
  opacity: 0.8,
  position: 'absolute',
  top: 0,
  left: 0,
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
  boxSizing: 'border-box',
  border: `${viewConstants.windowBorderWidth}px dashed #3b83f694`,
  borderRadius: `${viewConstants.windowBorderRadius}px`,

  selectors: {
    '&.snap': {
      opacity: 0.5,
      borderColor: '#b23bf6ff',
    },
    '&.snapping': {
      opacity: 0.3,
    },
  },
});