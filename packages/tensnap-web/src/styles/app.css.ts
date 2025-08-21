import { style } from '@vanilla-extract/css';
import { vars } from './global.css';

export const container = style({
  height: '100vh',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: vars.space.md,
  borderBottom: `1px solid ${vars.color.gridLine}`,
  backgroundColor: vars.color.background,
});

export const main = style({
  flex: 1,
  display: 'flex',
  padding: vars.space.md,
  gap: vars.space.md,
});

export const sidebar = style({
  width: '300px',
  backgroundColor: vars.color.gridBackground,
  borderRadius: vars.radius.md,
  padding: vars.space.md,
  height: 'fit-content',
});

export const content = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.md,
});

export const environmentGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(600px, 1fr))',
  gap: vars.space.md,
});

export const environmentCard = style({
  backgroundColor: vars.color.background,
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: vars.radius.md,
  padding: vars.space.md,
  boxShadow: vars.shadow.sm,
});

export const parameterControl = style({
  marginBottom: vars.space.md,
});

export const button = style({
  padding: `${vars.space.sm} ${vars.space.md}`,
  backgroundColor: vars.color.primary,
  color: '#ffffff',
  border: 'none',
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  fontSize: vars.fontSize.sm,
  fontWeight: 500,
  transition: 'background-color 0.2s',
  
  ':hover': {
    backgroundColor: '#0052a3',
  },
  
  ':active': {
    transform: 'translateY(1px)',
  },
  
  ':disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
});

export const slider = style({
  width: '100%',
  height: '4px',
  borderRadius: vars.radius.full,
  background: vars.color.gridLine,
  outline: 'none',
  
  selectors: {
    '&::-webkit-slider-thumb': {
      appearance: 'none',
      width: '16px',
      height: '16px',
      borderRadius: vars.radius.full,
      background: vars.color.primary,
      cursor: 'pointer',
    },
    '&::-moz-range-thumb': {
      width: '16px',
      height: '16px',
      borderRadius: vars.radius.full,
      background: vars.color.primary,
      cursor: 'pointer',
      border: 'none',
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
});

export const statusConnected = style([statusBadge, {
  backgroundColor: vars.color.success,
  color: '#ffffff',
}]);

export const statusDisconnected = style([statusBadge, {
  backgroundColor: vars.color.danger,
  color: '#ffffff',
}]);