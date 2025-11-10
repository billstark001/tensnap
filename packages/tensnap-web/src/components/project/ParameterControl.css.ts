import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/global.css';

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
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  appearance: 'none',

  selectors: {
    '&::-webkit-slider-runnable-track': {
      height: '4px',
      borderRadius: vars.radius.full,
      background: vars.color.gridLine,
    },
    '&::-webkit-slider-thumb': {
      WebkitAppearance: 'none',
      appearance: 'none',
      width: '16px',
      height: '16px',
      borderRadius: vars.radius.full,
      background: vars.color.primary,
      cursor: 'pointer',
      transition: 'transform 0.1s ease',
      marginTop: '-6px',
    },
    '&::-webkit-slider-thumb:hover': {
      transform: 'scale(1.1)',
    },
    '&::-moz-range-track': {
      height: '4px',
      borderRadius: vars.radius.full,
      background: vars.color.gridLine,
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
    'body[data-theme="dark"] &::-webkit-slider-runnable-track': {
      background: vars.color.darkGridLine,
    },
    'body[data-theme="dark"] &::-moz-range-track': {
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

export const sliderValueInput = style({
  minWidth: '40px',
  fontSize: vars.fontSize.sm,
  fontWeight: 500,
  color: vars.color.foreground,
  textAlign: 'right',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.primary}`,
  backgroundColor: vars.color.background,
  outline: 'none',
  boxSizing: 'border-box',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  appearance: 'none',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderColor: vars.color.primary,
      color: vars.color.darkForeground,
    },
  },
});

export const select = style({
  width: '100%',
  height: '100%',
  maxHeight: '100px',
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

const BORDER_SIZE = 2;
const THUMB_SIZE = 20;
const THUMB_SIZE_HORIZONTAL = 36;
const THUMB_PADDING = 2;

export const switchRoot = style({
  width: `${THUMB_SIZE_HORIZONTAL + THUMB_PADDING * 2 + BORDER_SIZE * 2}px`,
  height: `${THUMB_SIZE + THUMB_PADDING * 2 + BORDER_SIZE * 2}px`,
  backgroundColor: vars.color.background,
  border: `${BORDER_SIZE}px solid ${vars.color.foreground}`,
  borderRadius: '9999px',
  position: 'relative',
  selectors: {
    '&[data-state="checked"]': {
      backgroundColor: vars.color.primary,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderColor: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &[data-state="checked"]': {
      backgroundColor: vars.color.primary,
    },
  },
});

export const switchThumb = style({
  display: 'block',
  width: `${THUMB_SIZE}px`,
  height: `${THUMB_SIZE}px`,
  backgroundColor: vars.color.foreground,
  borderRadius: '9999px',
  transition: 'transform 100ms',
  transform: `translateX(${THUMB_PADDING}px)`,
  willChange: 'transform',
  selectors: {
    '&[data-state="checked"]': {
      transform: `translateX(${THUMB_PADDING + THUMB_SIZE_HORIZONTAL - THUMB_SIZE}px)`,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkForeground,
    },
  },
});

export const switchLabel = style({
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,
  lineHeight: 1,
  userSelect: 'none',
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
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
  boxSizing: 'border-box',
  WebkitAppearance: 'none',
  MozAppearance: 'none',
  appearance: 'none',

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
