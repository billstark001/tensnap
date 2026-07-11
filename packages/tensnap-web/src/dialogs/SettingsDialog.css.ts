import { style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const settingsContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.md,
});

export const sectionContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: vars.space.sm,
});

export const sectionTitle = style({
  fontSize: vars.fontSize.md,
  fontWeight: '600',
  color: vars.color.foreground,
  margin: 0,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const settingItem = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(118px, 0.9fr)',
  alignItems: 'start',
  gap: vars.space.sm,
  minWidth: 0,
});

export const systemSettingsGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  columnGap: vars.space.lg,
  rowGap: vars.space.md,

  '@media': {
    '(max-width: 680px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
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
  minWidth: 0,
  textAlign: 'left',
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

export const projectPathInput = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'default',
});

export const fieldHint = style({
  fontSize: '0.75rem',
  color: 'var(--color-text-secondary)',
  marginTop: '0.25rem',
});

export const visuallyHidden = style({
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
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
