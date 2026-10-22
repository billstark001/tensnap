import { vars } from '../../styles/global.css';
import { root as nativeScrollArea } from './ScrollArea.css';
import { globalStyle, style } from '@vanilla-extract/css';

export const selectTrigger = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  minWidth: 0,
  minHeight: 36,
  gap: vars.space.sm,
  padding: `6px ${vars.space.sm}`,
  lineHeight: 1.5,
  color: vars.color.foreground,
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
    '&[data-disabled]': { opacity: 0.6, cursor: 'not-allowed' },
  },
});

globalStyle(`${selectTrigger} > span:first-child`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
});
globalStyle(`${selectTrigger} > span:last-child`, { flexShrink: 0, display: 'inline-flex' });

export const selectContent = style([
  nativeScrollArea,
  {
    backgroundColor: vars.color.background,
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.secondary}`,
    boxShadow: vars.shadow.lg,
    minWidth: 'var(--radix-select-trigger-width)',
    maxWidth: 'var(--radix-select-content-available-width, calc(100vw - 8px))',
    maxHeight: 'min(320px, var(--radix-select-content-available-height, 80vh))',
    position: 'relative',
    zIndex: 50,

    selectors: {
      'body[data-theme="dark"] &': {
        backgroundColor: vars.color.darkBackground,
        borderColor: vars.color.darkBorder,
      },
    },
  },
]);

export const selectItem = style({
  fontSize: vars.fontSize.sm,
  lineHeight: 1.5,
  color: vars.color.foreground,
  borderRadius: vars.radius.sm,
  display: 'flex',
  alignItems: 'center',
  minHeight: 32,
  padding: `${vars.space.xs} ${vars.space.xl} ${vars.space.xs} ${vars.space.sm}`,
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
  right: vars.space.sm,
  width: vars.space.lg,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});
