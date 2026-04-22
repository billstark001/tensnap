import { style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const container = style({
  position: 'relative',
  width: '100%',
  height: '100%',
  display: 'flex',
  padding: 0,
});

export const svg = style({
  
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