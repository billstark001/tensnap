import { vars } from "@/styles/global.css";
import { globalStyle, style } from "@vanilla-extract/css";

export const selectTrigger = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  backgroundColor: vars.color.background,
  border: `1px solid ${vars.color.secondary}`,
  borderRadius: vars.radius.sm,
  fontSize: vars.fontSize.sm,
  cursor: 'pointer',
  transition: 'border-color 0.2s ease',
  
  selectors: {
    '&:focus': {
      outline: 'none',
      borderColor: vars.color.primary,
      boxShadow: `0 0 0 2px ${vars.color.overlayLight}`,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      color: vars.color.darkForeground,
      borderColor: vars.color.darkBorder,
    },
  },
});

export const selectContent = style({
  backgroundColor: vars.color.background,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.secondary}`,
  boxShadow: vars.shadow.lg,
  overflow: 'hidden',
  position: 'relative',
  zIndex: 50,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      borderColor: vars.color.darkBorder,
    },
  },
});


globalStyle('[data-radix-popper-content-wrapper]', {
  position: 'absolute',
  top: '0',
  left: '0',
  willChange: 'transform',
});


export const selectItem = style({
  fontSize: vars.fontSize.sm,
  lineHeight: 1,
  color: vars.color.foreground,
  borderRadius: vars.radius.sm,
  display: 'flex',
  alignItems: 'center',
  height: 25,
  padding: `0 ${vars.space.lg} 0 ${vars.space.md}`,
  position: 'relative',
  userSelect: 'none',
  cursor: 'pointer',
  outline: 'none',

  ':hover': {
    backgroundColor: vars.color.subtleBackground,
  },

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkTertiary,
    },
    '&[data-highlighted]': {
      backgroundColor: vars.color.primary,
      color: vars.color.terminalForeground,
    },
  },
});

export const selectItemIndicator = style({
  position: 'absolute',
  right: 0,
  width: vars.space.lg,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});