import { style } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

export const container = style({
  position: 'relative',
});

export const svg = style({
  border: `1px solid ${vars.color.subtleBorder}`,
  borderRadius: '4px',
  background: vars.color.subtleBackground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkSubtleBorder,
      background: vars.color.darkSubtleBackground,
    },
  },
});

export const modal = style({
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: vars.color.inputBackground,
  padding: '20px',
  borderRadius: '8px',
  boxShadow: vars.shadow.lg,
  zIndex: 1000,
  maxWidth: '400px',
  maxHeight: '80vh',
  overflow: 'auto',
  
  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkInputBackground,
    },
  },
});

export const modalTitle = style({
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const modalProperty = style({
  margin: '8px 0',
  fontSize: '14px',
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const modalCode = style({
  background: vars.color.inputHoverBackground,
  padding: '8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontFamily: 'monospace',
  overflow: 'auto',
  maxHeight: '200px',
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkInputHoverBackground,
      color: vars.color.darkForeground,
    },
  },
});

export const closeButton = style({
  marginTop: '16px',
  padding: '8px 16px',
  background: vars.color.primary,
  color: vars.color.terminalForeground,
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  ':hover': {
    background: vars.color.primaryHover,
  },
});

export const nodeText = style({
  textAnchor: 'middle',
  dominantBaseline: 'middle',
  fontSize: '10px',
  fill: vars.color.terminalForeground,
  pointerEvents: 'none',
  userSelect: 'none',
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
  zIndex: 10,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkSubtleBorder,
      color: vars.color.darkForeground,
    },
  },
});