import { vars } from '@tensnap/web-common/styles/global.css';
import { keyframes, style } from '@vanilla-extract/css';

export const statusBar = style({
  containerType: 'inline-size',
  containerName: 'statusbar',
  minWidth: 0,
  whiteSpace: 'nowrap',
  padding: `${vars.space.sm} ${vars.space.md}`,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.sm,
  borderBottom: `1px solid ${vars.color.gridLine}`,

  selectors: {
    'body[data-theme="dark"] &': {
      borderBottomColor: vars.color.darkGridLine,
    },
  },
});

export const statusBadge = style({
  display: 'inline-block',
  padding: `2px ${vars.space.sm}`,
  borderRadius: vars.radius.sm,
  fontSize: vars.fontSize.xs,
  fontWeight: 600,
  textTransform: 'uppercase',
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const statusConnected = style([
  statusBadge,
  {
    backgroundColor: vars.color.success,
    color: '#ffffff',
  },
]);

export const statusDisconnected = style([
  statusBadge,
  {
    backgroundColor: vars.color.danger,
    color: '#ffffff',
  },
]);

export const statusConnecting = style([
  statusBadge,
  {
    backgroundColor: vars.color.warning,
    color: '#000000',
  },
]);

export const statusRejected = style([
  statusBadge,
  {
    backgroundColor: vars.color.danger,
    color: '#ffffff',
  },
]);

export const statusMeta = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
  fontSize: vars.fontSize.sm,
  color: vars.color.foreground,
  display: 'inline-flex',
  alignItems: 'center',
  gap: vars.space.xs,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const metricValue = style({
  display: 'inline-block',
  minWidth: '4ch',
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
});

export const toggleButton = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
  padding: '4px 8px',
  cursor: 'pointer',
  background: 'transparent',
  border: `1px solid ${vars.color.secondary}`,
  borderRadius: vars.radius.sm,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  color: vars.color.foreground,
  transition: 'all 0.2s ease',

  ':hover': {
    backgroundColor: vars.color.gridBackground,
    borderColor: vars.color.primary,
  },

  ':active': {
    transform: 'scale(0.95)',
  },

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
      borderColor: vars.color.darkSecondary,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkTertiary,
      borderColor: vars.color.primary,
    },
  },
});

export const buttonGroup = style({
  flexShrink: 0,
  marginLeft: 'auto',
  display: 'flex',
  gap: vars.space.xs,
});

export const statusMetrics = style({
  flex: '1 1 0',
  minWidth: 0,
});
export const statusMetricsContent = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.sm,
  width: 'max-content',
  minWidth: '100%',
  whiteSpace: 'nowrap',
});
export const buttonText = style({
  '@container': { 'statusbar (max-width: 1000px)': { display: 'none' } },
});

const spin = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});
export const spinningIcon = style({
  animation: `${spin} 1s linear infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});
