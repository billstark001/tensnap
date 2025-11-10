import { style, styleVariants, globalStyle } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';
import { viewConstants } from './constants';

export const container = style({
  minWidth: '100px',
  minHeight: '100px',
  backgroundColor: vars.color.verySubtleBackground,
  overflow: 'auto',
  position: 'relative',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
    },
  },
});

export const rootView = style({
  position: 'relative',
  backgroundColor: vars.color.inputBackground,
  borderRadius: '8px',
  boxShadow: vars.shadow.lg,
  overflow: 'hidden',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      boxShadow: `0 10px 15px -3px ${vars.color.overlayDark}`,
    },
  },
});

export const draggableView = style({
  position: 'absolute',
  userSelect: 'none',
  transition: 'box-shadow 0.2s',
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
    backgroundColor: vars.color.border,
  },

  selectors: {
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkBorder,
    },
  },
});

export const dragIcon = style({
  width: '16px',
  height: '16px',
  color: vars.color.textTertiary,
  opacity: 0,
  transition: 'opacity 0.2s',

  selectors: {
    [`${dragHandle}:hover &`]: {
      opacity: 1,
    },
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
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
    backgroundColor: vars.color.primary,
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
    backgroundColor: vars.color.primary,
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
    backgroundColor: vars.color.primary,
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
  backgroundColor: vars.color.primary,
  color: vars.color.terminalForeground,
  borderRadius: '6px',
  padding: '8px',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background-color 0.2s, opacity 0.2s',
  ':hover': {
    backgroundColor: vars.color.primaryHover,
  },
});

export const buttonViewDisabled = style({
  opacity: 0.5,
  cursor: 'not-allowed',
  pointerEvents: 'none',
  ':hover': {
    backgroundColor: vars.color.primary,
  },
});

export const windowView = style({
  backgroundColor: vars.color.inputBackground,
  border: `${viewConstants.windowBorderWidth}px solid ${vars.color.inputBorder}`,
  borderRadius: `${viewConstants.windowBorderRadius}px`,
  boxSizing: 'border-box',
  boxShadow: vars.shadow.lg,
  height: '100%',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  transition: 'opacity 0.2s',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderColor: vars.color.darkInputBorder,
      boxShadow: `0 0 10px 0 ${vars.color.overlayDark}`,
    },

    [`${draggingView} &`]: {
      border: `${viewConstants.windowBorderWidth}px dashed ${vars.color.primary}`,
    }
  },
});

export const windowViewDisabled = style({
  opacity: 0.5,
  pointerEvents: 'none',
});

export const windowViewHeader = style({
  backgroundColor: vars.color.subtleBackground,
  padding: '6px 8px',
  borderBottom: `1px solid ${vars.color.inputBorder}`,
  borderTopLeftRadius: `${viewConstants.windowBorderRadius - viewConstants.windowBorderWidth}px`,
  borderTopRightRadius: `${viewConstants.windowBorderRadius - viewConstants.windowBorderWidth}px`,
  height: `${viewConstants.windowHeaderHeight - viewConstants.windowBorderWidth * 2}px`,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkTertiary,
      borderBottomColor: vars.color.darkInputBorder,
    },
  },
});

export const windowViewTitle = style({
  fontSize: '14px',
  fontWeight: 500,
  color: vars.color.foreground,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const windowViewExpandButtonContainer = style({
  display: 'flex',
  alignItems: 'center',
});

export const expandButton = style({
  background: 'none',
  border: 'none',
  padding: '0',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  color: vars.color.textTertiary,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
    '&:hover': {
      color: vars.color.foreground,
    },
    'body[data-theme="dark"] &:hover': {
      color: vars.color.darkForeground,
    },
  },
});

globalStyle(`${expandButton} .icon`, {
  width: '16px',
  height: '16px',
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
  borderColor: vars.color.primary,
  backgroundColor: vars.color.verySubtleBackground,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkVerySubtleBackground,
    },
  },
});

export const dragOverlayAnchor = style({
  position: 'absolute',
  backgroundColor: vars.color.overlayLight,
  top: 0,
  left: 0,
  minWidth: `${viewConstants.dragHandleMinWidth}px`,
  minHeight: `${viewConstants.dragHandleMinHeight}px`,
  borderRadius: `${viewConstants.windowBorderRadius}px`,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.overlayDark,
    },
  },
});

export const dragOverlay = style({
  opacity: 0.8,
  position: 'absolute',
  top: 0,
  left: 0,
  boxShadow: vars.shadow.lg,
  boxSizing: 'border-box',
  border: `${viewConstants.windowBorderWidth}px dashed ${vars.color.primary}`,
  borderRadius: `${viewConstants.windowBorderRadius}px`,

  selectors: {
    '&.snap': {
      opacity: 0.5,
      borderColor: vars.color.info,
    },
    '&.snapping': {
      opacity: 0.3,
    },
  },
});