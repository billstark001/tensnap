import { style } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

export const container = style({
  position: 'relative',
  width: '100%',
  height: '100%',
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