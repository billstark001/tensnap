import { vars } from "@/styles/global.css";
import { style } from "@vanilla-extract/css";


export const fakeModelCardContainer = style({
  border: `1px solid ${vars.color.border}`,
  borderRadius: '8px',
  padding: '16px',
  cursor: 'pointer',
  transition: 'all 0.2s',
  backgroundColor: vars.color.cardBackground,

  selectors: {
    '&:hover': {
      backgroundColor: vars.color.cardHoverBackground,
      borderColor: vars.color.primary,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkCardBackground,
      borderColor: vars.color.darkBorder,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkCardHoverBackground,
      borderColor: vars.color.darkTextPrimary,
    },
  }
});

export const fakeModelTitle = style({
  margin: '0 0 8px 0',
  fontSize: '16px',
  fontWeight: '600',
});

export const fakeModelDescription = style({
  margin: 0,
  fontSize: '14px',
  color: vars.color.textSecondary,
  lineHeight: '1.5',
});

export const fakeModelSection = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '16px',
  padding: '8px',
});

export const fakeModelSectionTitle = style({
  gridColumn: '1 / -1',
  margin: '0 0 8px 0',
});