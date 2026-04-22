import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "../../styles/global.css";

export const formInput = style({
  width: '100%',
  padding: `${vars.space.sm} ${vars.space.md}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.secondary}`,
  fontSize: vars.fontSize.sm,
  transition: 'border-color 0.2s ease',
  
  selectors: {
    '&:focus': {
      outline: 'none',
      borderColor: vars.color.primary,
      boxShadow: `0 0 0 2px rgba(0, 102, 204, 0.2)`,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      color: vars.color.darkForeground,
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
  },
});

export const formLabel = style({
  display: 'block',
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  color: vars.color.foreground,
  marginBottom: vars.space.xs,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const formFieldSet = style({
  border: 'none',
  padding: 0,
  margin: 0,
  marginBottom: vars.space.md,
});

export const formFieldGroup = style({
  display: 'grid',
  gap: vars.space.md,
  marginBottom: vars.space.md,
});

globalStyle(`${formFieldGroup} > *`, {
  minWidth: 0, // Prevent grid items from overflowing
});
