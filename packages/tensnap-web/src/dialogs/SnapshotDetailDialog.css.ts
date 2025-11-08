import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

export const detailContainer = style({
  height: '100%',
  display: 'flex',
  flexDirection: 'row',
  gap: vars.space.sm,
  maxHeight: '60vh',
  overflowY: 'auto',
});

export const detailSection = style({
  marginBottom: vars.space.lg,
  minWidth: '300px',

  selectors: {
    '&.scroll': {
      overflowY: 'auto',
    },
    '&.env': {
      flex: 1,
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
  },
});



export const detailRow = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${vars.space.sm} 0`,
  borderBottom: `1px solid rgba(0, 0, 0, 0.05)`,

  selectors: {
    '&:last-child': {
      borderBottom: 'none',
    },
    'body[data-theme="dark"] &': {
      borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    },
  },
});

export const detailLabel = style({
  fontWeight: '600',
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const detailValue = style({
  color: vars.color.secondary,
  fontSize: vars.fontSize.sm,
  fontFamily: 'monospace',

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const sectionTitle = style({
  fontSize: vars.fontSize.md,
  fontWeight: '600',
  color: vars.color.foreground,
  marginBottom: vars.space.md,
  marginTop: 0,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const parameterList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.sm,
});

export const parameterItem = style({
  display: 'flex',
  justifyContent: 'space-between',
  padding: vars.space.sm,
  backgroundColor: 'rgba(0, 0, 0, 0.02)',
  borderRadius: vars.radius.sm,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
  },
});

export const parameterLabel = style({
  fontWeight: '500',
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const parameterValue = style({
  color: vars.color.secondary,
  fontSize: vars.fontSize.sm,
  fontFamily: 'monospace',

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const environmentList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.sm,
});

export const environmentItem = style({
  backgroundColor: 'rgba(0, 0, 0, 0.02)',
  borderRadius: vars.radius.sm,
  border: `1px solid rgba(0, 0, 0, 0.1)`,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

export const environmentHeader = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: vars.space.sm,
  padding: vars.space.sm,
});

export const environmentType = style({
  fontSize: vars.fontSize.xs,
  fontWeight: '600',
  color: vars.color.primary,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

export const environmentLabel = style({
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  color: vars.color.foreground,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const environmentDisplay = style({
  fontSize: vars.fontSize.xs,
  color: vars.color.secondary,
  minHeight: '500px',
  minWidth: '500px',
  display: 'flex',

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

globalStyle(`${environmentDisplay} > * > *`, {
  minHeight: '500px',
  minWidth: '500px',
});
