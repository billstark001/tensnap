import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const detailContainer = style({
  height: 'min(72vh, 760px)',
  display: 'flex',
  flexDirection: 'row',
  gap: vars.space.sm,
  maxHeight: '60vh',
  overflow: 'hidden',
});

export const replaySidebar = style({
  width: '300px',
  minWidth: '260px',
  overflowY: 'auto',
  minHeight: 0,
});

export const replayContent = style({
  flex: 1,
  minWidth: 0,
  overflowY: 'auto',
  minHeight: 0,
});

export const timelineControls = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.xs,
  margin: `${vars.space.md} 0`,
});

export const timelineButton = style({
  width: '30px',
  height: '30px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  background: vars.color.inputBackground,
  color: vars.color.foreground,
  cursor: 'pointer',
  selectors: {
    'body[data-theme="dark"] &': { borderColor: vars.color.darkInputBorder, background: vars.color.darkInputBackground, color: vars.color.darkForeground },
  },
});

export const timelineRange = style({
  flex: 1,
  minWidth: 0,
});

export const truncatedNotice = style({
  fontSize: vars.fontSize.xs,
  color: vars.color.secondary,
  margin: `${vars.space.xs} 0 ${vars.space.md}`,
});

export const chartList = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: vars.space.md,
  marginTop: vars.space.md,
});

export const chartItem = style({
  height: '260px',
  minWidth: 0,
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: vars.radius.sm,
  padding: vars.space.sm,
  selectors: {
    'body[data-theme="dark"] &': { borderColor: vars.color.darkGridLine },
  },
});

globalStyle(`${chartItem} > div`, {
  flex: 1,
  minHeight: 0,
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

export const snapshotNameInput = style({
  minWidth: 0,
  width: '170px',
  border: `1px solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  background: vars.color.inputBackground,
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkInputBorder,
      background: vars.color.darkInputBackground,
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
  height: 'min(46vh, 440px)',
  minHeight: '220px',
  minWidth: 0,
  width: '100%',
  maxWidth: 'none',
  overflow: 'hidden',
  padding: 0,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

globalStyle(`${environmentDisplay} > *`, {
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
});

globalStyle(`${environmentDisplay} > * > div`, {
  minHeight: 0,
  minWidth: 0,
  width: '100%',
  height: '100%',
});

globalStyle(`${environmentDisplay} svg`, {
  margin: 0,
});
