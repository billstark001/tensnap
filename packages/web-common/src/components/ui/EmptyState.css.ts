import { style } from '@vanilla-extract/css';
import { vars } from '../../styles/global.css';

export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 32px',
  color: vars.color.textTertiary,
  fontSize: '14px',
  textAlign: 'center',
  gap: '12px',
  minHeight: '200px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const emptyStateCompact = style([emptyState, {
  padding: '32px 24px',
  minHeight: '150px',
}]);

export const emptyStateIcon = style({
  fontSize: '48px',
  opacity: 0.4,
  marginBottom: '8px',
});

export const emptyStateTitle = style({
  fontSize: '16px',
  fontWeight: '500',
  color: vars.color.textSecondary,
  marginBottom: '4px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
  },
});

export const emptyStateDescription = style({
  fontSize: '14px',
  color: vars.color.textTertiary,
  lineHeight: '1.5',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const emptyStateActions = style({
  display: 'flex',
  gap: '8px',
  marginTop: '16px',
  flexWrap: 'wrap',
  justifyContent: 'center',
});

export const emptyStateButton = style({
  padding: '8px 16px',
  border: `1px solid ${vars.color.subtleBorder}`,
  borderRadius: '4px',
  backgroundColor: vars.color.inputBackground,
  cursor: 'pointer',
  fontSize: '14px',
  color: vars.color.textPrimary,
  fontWeight: '500',
  transition: 'all 0.2s',
  
  ':hover': {
    backgroundColor: vars.color.inputHoverBackground,
    borderColor: vars.color.primary,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkSubtleBorder,
      color: vars.color.darkTextPrimary,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground,
      borderColor: vars.color.primary,
    },
  },
});

export const emptyStatePrimaryButton = style([emptyStateButton, {
  backgroundColor: vars.color.primary,
  color: vars.color.background,
  borderColor: vars.color.primary,
  
  ':hover': {
    backgroundColor: vars.color.primaryHover,
    borderColor: vars.color.primaryHover,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.primary,
      color: vars.color.darkForeground,
      borderColor: vars.color.primary,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.primaryHover,
      borderColor: vars.color.primaryHover,
    },
  },
}]);

export const uploadArea = style({
  border: `2px dashed ${vars.color.inputBorder}`,
  borderRadius: '8px',
  padding: '24px',
  marginTop: '16px',
  textAlign: 'center',
  backgroundColor: vars.color.subtleBackground,
  transition: 'all 0.2s',
  cursor: 'pointer',
  minWidth: '280px',
  
  ':hover': {
    borderColor: vars.color.primary,
    backgroundColor: vars.color.cardHoverBackground,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkInputBorder,
      backgroundColor: vars.color.darkSubtleBackground,
    },
    'body[data-theme="dark"] &:hover': {
      borderColor: vars.color.primary,
      backgroundColor: vars.color.darkCardHoverBackground,
    },
  },
});

export const uploadAreaActive = style([uploadArea, {
  borderColor: vars.color.primary,
  backgroundColor: vars.color.cardHoverBackground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkCardHoverBackground,
    },
  },
}]);

export const uploadText = style({
  fontSize: '14px',
  color: vars.color.textSecondary,
  marginBottom: '4px',
  fontWeight: '500',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
  },
});

export const uploadHint = style({
  fontSize: '12px',
  color: vars.color.textTertiary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});
