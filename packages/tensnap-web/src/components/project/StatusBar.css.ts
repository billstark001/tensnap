import { vars } from "@/styles/global.css";
import { style } from "@vanilla-extract/css";


export const statusBar = style({
  padding: vars.space.sm,
  display: 'flex',
  alignItems: 'center',
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
