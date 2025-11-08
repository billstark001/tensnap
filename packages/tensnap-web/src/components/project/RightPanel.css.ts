import { vars } from "@/styles/global.css";
import { style } from "@vanilla-extract/css";

export const rightPanel = style({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: vars.color.background,
  borderLeft: `1px solid ${vars.color.gridLine}`,
  overflow: 'hidden',
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      borderLeftColor: vars.color.darkGridLine,
    },
  },
});

export const panelHeader = style({
  padding: vars.space.md,
  borderBottom: `1px solid ${vars.color.gridLine}`,
  backgroundColor: vars.color.gridBackground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderBottomColor: vars.color.darkGridLine,
    },
  },
});

export const headerButtons = style({
  display: 'flex',
  gap: vars.space.sm,
  marginTop: vars.space.sm,
});

export const headerButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.xs,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  backgroundColor: vars.color.primary,
  color: 'white',
  border: 'none',
  borderRadius: vars.radius.sm,
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 0.2s ease',

  selectors: {
    '&:hover': {
      backgroundColor: '#0052a3',
    },
    '&:disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
    '&:disabled:hover': {
      backgroundColor: vars.color.primary,
    },
  },
});

export const panelContent = style({
  padding: vars.space.md,
  overflowY: 'auto',
  flex: 1,
});

export const emptyMessage = style({
  color: vars.color.secondary,
  fontSize: vars.fontSize.sm,
  textAlign: 'center',
  padding: vars.space.lg,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const snapshotList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.sm,
});

export const snapshotItem = style({
  padding: vars.space.md,
  backgroundColor: 'rgba(0, 0, 0, 0.02)',
  borderRadius: vars.radius.sm,
  border: `1px solid rgba(0, 0, 0, 0.1)`,
  cursor: 'pointer',
  transition: 'all 0.2s ease',

  selectors: {
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderColor: vars.color.primary,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
      borderColor: 'rgba(255, 255, 255, 0.1)',
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderColor: vars.color.primary,
    },
  },
});

export const snapshotHeader = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: vars.space.sm,
});

export const snapshotId = style({
  fontSize: vars.fontSize.sm,
  fontWeight: '600',
  color: vars.color.foreground,
  fontFamily: 'monospace',

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const snapshotTime = style({
  fontSize: vars.fontSize.xs,
  color: vars.color.secondary,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const snapshotInfo = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.xs,
});

export const snapshotInfoRow = style({
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: vars.fontSize.xs,
});

export const snapshotLabel = style({
  fontWeight: '500',
  color: vars.color.secondary,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const snapshotValue = style({
  color: vars.color.foreground,
  fontFamily: 'monospace',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: '200px',

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});
