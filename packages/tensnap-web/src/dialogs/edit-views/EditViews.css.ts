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
