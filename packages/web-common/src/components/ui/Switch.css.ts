import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/global.css';

export const field = style({ display: 'inline-flex', alignItems: 'center', gap: vars.space.sm });

export const root = style({
  width: 42,
  height: 24,
  padding: 0,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  backgroundColor: vars.color.secondary,
  borderRadius: 12,
  position: 'relative',
  border: 'none',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  selectors: {
    '&[data-state="checked"]': { backgroundColor: vars.color.primary },
    '&:focus-visible': { outline: `2px solid ${vars.color.primary}`, outlineOffset: 2 },
    '&:disabled': { opacity: 0.5, cursor: 'default' },
  },
  '@media': { '(prefers-reduced-motion: reduce)': { transition: 'none' } },
});

export const thumb = style({
  display: 'block',
  width: 18,
  height: 18,
  backgroundColor: vars.color.terminalForeground,
  borderRadius: 9,
  transition: 'transform 0.2s ease',
  transform: 'translateX(3px)',
  selectors: { '&[data-state="checked"]': { transform: 'translateX(21px)' } },
  '@media': { '(prefers-reduced-motion: reduce)': { transition: 'none' } },
});
