import { style } from '@vanilla-extract/css';
import { vars } from '../styles/global.css';

export const parameterContainer = style({
  marginBottom: vars.space.md,
});

export const label = style({
  display: 'block',
  marginBottom: vars.space.xs,
  fontSize: vars.fontSize.sm,
  fontWeight: 500,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const sliderContainer = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.xs,

  padding: vars.space.sm,
});

export const slider = style({
  flex: 1,
  height: '4px',
  borderRadius: vars.radius.full,
  background: vars.color.gridLine,
  outline: 'none',
  cursor: 'pointer',
  
  selectors: {
    '&::-webkit-slider-thumb': {
      appearance: 'none',
      width: '16px',
      height: '16px',
      borderRadius: vars.radius.full,
      background: vars.color.primary,
      cursor: 'pointer',
      transition: 'transform 0.1s ease',
    },
    '&::-webkit-slider-thumb:hover': {
      transform: 'scale(1.1)',
    },
    '&::-moz-range-thumb': {
      width: '16px',
      height: '16px',
      borderRadius: vars.radius.full,
      background: vars.color.primary,
      cursor: 'pointer',
      border: 'none',
      transition: 'transform 0.1s ease',
    },
    '&::-moz-range-thumb:hover': {
      transform: 'scale(1.1)',
    },
    'body[data-theme="dark"] &': {
      background: vars.color.darkGridLine,
    },
  },
});

export const sliderValue = style({
  minWidth: '40px',
  fontSize: vars.fontSize.sm,
  fontWeight: 500,
  color: vars.color.secondary,
  textAlign: 'right',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const select = style({
  width: '100%',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.gridLine}`,
  fontSize: vars.fontSize.sm,
  backgroundColor: vars.color.background,
  color: vars.color.foreground,
  cursor: 'pointer',
  outline: 'none',
  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  
  ':focus': {
    borderColor: vars.color.primary,
    boxShadow: `0 0 0 2px ${vars.color.primary}20`,
  },
  
  ':hover': {
    borderColor: vars.color.primary,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderColor: vars.color.darkGridLine,
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:focus': {
      borderColor: vars.color.primary,
      boxShadow: `0 0 0 2px ${vars.color.primary}20`,
    },
    'body[data-theme="dark"] &:hover': {
      borderColor: vars.color.primary,
    },
  },
});

export const option = style({
  padding: vars.space.xs,
  backgroundColor: vars.color.background,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      color: vars.color.darkForeground,
    },
  },
});
