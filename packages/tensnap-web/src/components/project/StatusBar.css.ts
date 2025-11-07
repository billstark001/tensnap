import { vars } from "@/styles/global.css";
import { style } from "@vanilla-extract/css";


export const statusBar = style({
  padding: vars.space.sm,
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.sm,
  borderBottom: `1px solid ${vars.color.gridLine}`,
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

export const toggleButton = style({
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
  marginLeft: 'auto',
  display: 'flex',
  gap: vars.space.xs,
});
