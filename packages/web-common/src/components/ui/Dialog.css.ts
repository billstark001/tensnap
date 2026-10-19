import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/global.css';

export const dialogDescription = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.secondary,
  marginBottom: vars.space.md,
  lineHeight: 1.5,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const dialogBody = style({
  minHeight: 0,
  overflowY: 'auto',

  selectors: {
    '[data-dialog-size="full"] &': {
      // The save picker adds a current-directory description above the file
      // list. Let this section consume only the remaining dialog height so
      // that a taller footer never overflows the viewport.
      flex: '1 1 0',
      minHeight: 0,
      overflow: 'hidden',
    },
  },
});

export const dialogFooter = style({
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: vars.space.sm,
  marginTop: vars.space.lg,
  paddingTop: vars.space.md,
  borderTop: `1px solid rgba(0, 0, 0, 0.1)`,
  flexShrink: 0,

  selectors: {
    'body[data-theme="dark"] &': {
      borderTopColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

export const dialogButton = style({
  padding: `${vars.space.sm} ${vars.space.md}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.secondary}`,
  backgroundColor: vars.color.background,
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.xs,

  selectors: {
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderColor: vars.color.foreground,
    },
    '&:focus': {
      outline: `2px solid ${vars.color.primary}`,
      outlineOffset: '2px',
    },
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    '&:disabled:hover': {
      backgroundColor: vars.color.background,
      borderColor: vars.color.secondary,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      color: vars.color.darkForeground,
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

export const dialogButtonPrimary = style([
  dialogButton,
  {
    backgroundColor: vars.color.primary,
    color: vars.color.background,
    borderColor: vars.color.primary,

    selectors: {
      '&:hover': {
        backgroundColor: '#0052a3',
        borderColor: '#0052a3',
      },
      '&:disabled': {
        backgroundColor: vars.color.secondary,
        borderColor: vars.color.secondary,
      },
    },
  },
]);

export const dialogButtonDanger = style([
  dialogButton,
  {
    backgroundColor: vars.color.danger,
    color: vars.color.background,
    borderColor: vars.color.danger,

    selectors: {
      '&:hover': {
        backgroundColor: '#a30000',
        borderColor: '#a30000',
      },
    },
  },
]);

export const dialogSeparator = style({
  height: '1px',
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
  margin: `${vars.space.md} 0`,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    '&.vertical': {
      width: '1px',
      height: 'auto',
      margin: `0 ${vars.space.md}`,
    },
  },
});
