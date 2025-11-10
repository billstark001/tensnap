import { style } from "@vanilla-extract/css";
import { vars } from "../../styles/global.css";

// Disabled field style
export const disabledField = style({
  opacity: 0.6,
  cursor: 'not-allowed',
});

// Checkbox container style
export const checkboxLabel = style({
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
});

export const checkboxInput = style({
  marginRight: vars.space.sm,
  cursor: 'pointer',
});

// Info display styles
export const infoText = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.foreground,
  opacity: 0.7,
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  }
});

// Series list styles
export const seriesList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.xs,
  fontSize: vars.fontSize.sm,
  maxHeight: '200px',
  overflowY: 'auto',
  padding: vars.space.sm,
  border: `1px solid rgba(0, 0, 0, 0.1)`,
  borderRadius: vars.radius.sm,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: 'rgba(255, 255, 255, 0.2)',
    },
  },
});

export const seriesItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.sm,
  padding: vars.space.xs,
});

export const seriesColor = style({
  width: '12px',
  height: '12px',
  borderRadius: '2px',
  flexShrink: 0,
});

export const seriesLabel = style({
  fontWeight: 500,
});

export const seriesId = style({
  opacity: 0.6,
  fontSize: '0.75rem',
});

// Select component styles
export const selectTrigger = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.fontSize.sm,
  lineHeight: 1,
  height: 35,
  gap: vars.space.xs,
  backgroundColor: vars.color.background,
  color: vars.color.foreground,
  border: `1px solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  outline: 'none',
  width: '100%',

  ':hover': {
    backgroundColor: vars.color.subtleBackground,
  },

  ':focus': {
    boxShadow: `0 0 0 2px ${vars.color.primary}20`,
  },

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderColor: vars.color.darkInputBorder,
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkTertiary,
    },
  },
});

// Icon button style
export const iconButton = style({
  background: 'none',
  border: 'none',
  padding: vars.space.xs,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.color.foreground,
  borderRadius: vars.radius.sm,
  transition: 'background-color 0.2s',

  ':hover': {
    backgroundColor: vars.color.subtleBackground,
  },

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkTertiary,
    },
  },
});
