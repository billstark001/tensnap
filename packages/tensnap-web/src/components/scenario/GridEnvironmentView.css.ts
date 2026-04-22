// GridEnvironmentView.css.ts
import { style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const container = style({
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'auto',
});

export const canvasContainer = style({
  cursor: 'crosshair',
  width: '100%',
  height: '100%',
  minWidth: '200px',
  minHeight: '200px',
});

export const contextMenu = style({
  position: 'fixed',
  background: vars.color.inputBackground,
  border: `1px solid ${vars.color.subtleBorder}`,
  borderRadius: '4px',
  padding: '4px 0',
  boxShadow: vars.shadow.md,
  zIndex: 999,
  
  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkInputBackground,
      borderColor: vars.color.darkSubtleBorder,
    },
  },
});

export const contextMenuItem = style({
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: '14px',
  color: vars.color.foreground,
  
  ':hover': {
    background: vars.color.verySubtleBackground,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      background: vars.color.darkVerySubtleBackground,
    },
  },
});

export const resetButton = style({
  position: 'absolute',
  top: '10px',
  right: '10px',
  padding: '8px 12px',
  backgroundColor: vars.color.inputBackground,
  border: `1px solid ${vars.color.subtleBorder}`,
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  color: vars.color.foreground,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkSubtleBorder,
      color: vars.color.darkForeground,
    },
    '&:hover': {
      backgroundColor: vars.color.inputHoverBackground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground,
    },
  },
});