import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

export const settingsContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.lg,
});

export const sectionContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.md,
});

export const sectionTitle = style({
  fontSize: vars.fontSize.md,
  fontWeight: '600',
  color: vars.color.foreground,
  marginBottom: vars.space.sm,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const settingItem = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: `${vars.space.sm} 0`,
});

export const settingLabel = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const settingControl = style({
  minWidth: '120px',
  textAlign: 'right',
});

export const switchContainer = style({
  display: 'inline-flex',
  alignItems: 'center',
});

export const switchRoot = style({
  width: '42px',
  height: '24px',
  backgroundColor: vars.color.secondary,
  borderRadius: '12px',
  position: 'relative',
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  
  selectors: {
    '&[data-state="checked"]': {
      backgroundColor: vars.color.primary,
    },
    '&:focus': {
      outline: `2px solid ${vars.color.primary}`,
      outlineOffset: '2px',
    },
  },
});

export const switchThumb = style({
  display: 'block',
  width: '18px',
  height: '18px',
  backgroundColor: vars.color.terminalForeground,
  borderRadius: '9px',
  transition: 'transform 0.2s ease',
  transform: 'translateX(3px)',
  
  selectors: {
    '[data-state="checked"] &': {
      transform: 'translateX(21px)',
    },
  },
});

export const selectContainer = style({
  position: 'relative',
  minWidth: '120px',
});

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
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.fontSize.sm,
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.border,
    },
    '&[data-highlighted]': {
      backgroundColor: vars.color.primary,
      color: vars.color.terminalForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkBorder,
    },
  },
});

export const projectSettingsContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.md,
});

export const projectSettingsForm = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.md,
});

export const projectSettingsFooter = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: vars.space.sm,
  paddingTop: vars.space.md,
  borderTop: `1px solid ${vars.color.border}`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderTopColor: vars.color.darkBorder,
    },
  },
});

export const themeLabel = style({
  marginLeft: vars.space.sm,
  fontSize: vars.fontSize.xs,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});