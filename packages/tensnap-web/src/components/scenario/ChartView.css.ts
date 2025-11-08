import { style } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

export const chartContainer = style({
  width: '100%'
});

export const exportButton = style({
  padding: '6px 12px',
  fontSize: '12px',
  background: vars.color.verySubtleBackground,
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  color: vars.color.foreground,
  
  ':hover': {
    background: vars.color.inputHoverBackground,
  },
  
  ':active': {
    background: vars.color.cardHoverBackground,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkVerySubtleBackground,
      borderColor: vars.color.darkGridLine,
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      background: vars.color.darkInputHoverBackground,
    },
    'body[data-theme="dark"] &:active': {
      background: vars.color.darkCardHoverBackground,
    },
  },
});

export const buttonContainer = style({
  marginBottom: '10px'
});

export const chartViewContainer = style({
  width: '100%',
  height: '300px'
});
