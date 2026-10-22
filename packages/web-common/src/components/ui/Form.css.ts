import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../../styles/global.css';

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

export const formSelect = style([
  formInput,
  {
    appearance: 'none',
    minHeight: 36,
    padding: `6px ${vars.space.xl} 6px ${vars.space.sm}`,
    lineHeight: 1.5,
    backgroundColor: vars.color.background,
    color: vars.color.foreground,
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236c757d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
    backgroundPosition: 'right 8px center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 16,
    cursor: 'pointer',
    selectors: {
      '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
      '&[multiple], &[size]:not([size="1"])': {
        backgroundImage: 'none',
        paddingRight: vars.space.sm,
      },
    },
  },
]);

export const colorField = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.sm,
  width: '100%',
});
export const colorPicker = style([
  formInput,
  { flex: '0 0 40px', width: 40, height: 36, padding: 3, cursor: 'pointer' },
]);
export const colorValue = style([formInput, { flex: 1, minWidth: 0 }]);

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
