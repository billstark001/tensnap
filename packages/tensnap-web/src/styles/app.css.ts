import { style, keyframes } from '@vanilla-extract/css';
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
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      borderBottomColor: vars.color.darkGridLine,
    },
  },
});

export const main = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: vars.space.md,
});

export const sidebar = style({
  width: '300px',
  backgroundColor: vars.color.gridBackground,
  borderRadius: vars.radius.md,
  padding: vars.space.md,
  height: 'fit-content',
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkGridBackground,
    },
  },
});

export const statusBar = style({
  padding: vars.space.sm,
  display: 'flex',
  alignItems: 'center',
})

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
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      borderColor: vars.color.darkGridLine,
    },
  },
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

export const spinnerOverlay = style({
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999, // 确保在所有dialogs之上
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
    },
  },
});

const spin = keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' }
});

export const spinner = style({
  width: '40px',
  height: '40px',
  border: `4px solid ${vars.color.gridLine}`,
  borderTop: `4px solid ${vars.color.primary}`,
  borderRadius: vars.radius.full,
  animation: `${spin} 1s linear infinite`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkGridLine,
      borderTopColor: vars.color.primary,
    },
  },
});