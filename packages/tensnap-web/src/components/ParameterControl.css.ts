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

export const controlContainer = style({
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

export const switchRoot = style({
  width: '42px',
  height: '25px',
  backgroundColor: vars.color.background,
  borderRadius: '9999px',
  position: 'relative',
  boxShadow: `0 2px 10px ${vars.color.secondary}`,
  WebkitTapHighlightColor: 'rgba(0, 0, 0, 0)',
  selectors: {
    '&:focus': {
      boxShadow: `0 0 0 2px ${vars.color.primary}`,
    },
    '&[data-state="checked"]': {
      backgroundColor: vars.color.primary,
    },
  },
});

export const switchThumb = style({
  display: 'block',
  width: '21px',
  height: '21px',
  backgroundColor: vars.color.foreground,
  borderRadius: '9999px',
  boxShadow: `0 2px 2px ${vars.color.secondary}`,
  transition: 'transform 100ms',
  transform: 'translateX(2px)',
  willChange: 'transform',
  selectors: {
    '&[data-state="checked"]': {
      transform: 'translateX(19px)',
    },
  },
});

export const switchLabel = style({
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,
  lineHeight: 1,
  userSelect: 'none',
});

export const textInput = style({
  width: '100%',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.gridLine}`,
  fontSize: vars.fontSize.sm,
  backgroundColor: vars.color.background,
  color: vars.color.foreground,
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
