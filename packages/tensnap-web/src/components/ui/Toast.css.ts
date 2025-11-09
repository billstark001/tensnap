import { style, keyframes } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

const slideIn = keyframes({
  from: {
    transform: 'translateX(calc(100% + 16px))',
    opacity: 0,
  },
  to: {
    transform: 'translateX(0)',
    opacity: 1,
  },
});

const slideOut = keyframes({
  from: {
    transform: 'translateX(0)',
    opacity: 1,
  },
  to: {
    transform: 'translateX(calc(100% + 16px))',
    opacity: 0,
  },
});

export const toastViewport = style({
  position: 'fixed',
  bottom: 0,
  right: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: vars.space.md,
  gap: vars.space.sm,
  width: '420px',
  maxWidth: '100vw',
  margin: 0,
  listStyle: 'none',
  zIndex: 2147483647,
  outline: 'none',
  pointerEvents: 'none',
});

export const toastRoot = style({
  backgroundColor: vars.color.cardBackground,
  border: `1px solid ${vars.color.cardBorder}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.lg,
  padding: vars.space.md,
  display: 'flex',
  alignItems: 'flex-start',
  gap: vars.space.sm,
  pointerEvents: 'auto',
  position: 'relative',
  overflow: 'hidden',
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkCardBackground,
      borderColor: vars.color.darkCardBorder,
    },
    '&[data-state="open"]': {
      animation: `${slideIn} 200ms cubic-bezier(0.16, 1, 0.3, 1)`,
    },
    '&[data-state="closed"]': {
      animation: `${slideOut} 100ms ease-in`,
    },
    '&[data-swipe="move"]': {
      transform: 'translateX(var(--radix-toast-swipe-move-x))',
    },
    '&[data-swipe="cancel"]': {
      transform: 'translateX(0)',
      transition: 'transform 200ms ease-out',
    },
    '&[data-swipe="end"]': {
      animation: `${slideOut} 100ms ease-out`,
    },
  },
});

export const toastSuccess = style({
  borderLeftWidth: '4px',
  borderLeftColor: vars.color.success,
});

export const toastError = style({
  borderLeftWidth: '4px',
  borderLeftColor: vars.color.danger,
});

export const toastWarning = style({
  borderLeftWidth: '4px',
  borderLeftColor: vars.color.warning,
});

export const toastInfo = style({
  borderLeftWidth: '4px',
  borderLeftColor: vars.color.info,
});

export const toastIconWrapper = style({
  flexShrink: 0,
  width: '20px',
  height: '20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const toastContent = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.xs,
});

export const toastTitle = style({
  fontSize: vars.fontSize.sm,
  fontWeight: 600,
  lineHeight: 1.4,
  color: vars.color.textPrimary,
  margin: 0,
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary,
    },
  },
});

export const toastDescription = style({
  fontSize: vars.fontSize.sm,
  lineHeight: 1.4,
  color: vars.color.textSecondary,
  margin: 0,
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
  },
});

export const toastClose = style({
  flexShrink: 0,
  width: '20px',
  height: '20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: vars.radius.sm,
  border: 'none',
  background: 'transparent',
  color: vars.color.textSecondary,
  cursor: 'pointer',
  transition: 'all 150ms ease',
  ':hover': {
    backgroundColor: vars.color.inputHoverBackground,
    color: vars.color.textPrimary,
  },
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground,
      color: vars.color.darkTextPrimary,
    },
  },
});

export const toastProgress = style({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  height: '3px',
  backgroundColor: vars.color.primary,
  transformOrigin: 'left',
  transition: 'transform linear',
});
