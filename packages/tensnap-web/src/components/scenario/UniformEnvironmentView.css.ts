// UniformEnvironmentView.css.ts
import { style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const container = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
  padding: '16px',
  backgroundColor: vars.color.cardBackground,
  borderRadius: '8px',
  border: `1px solid ${vars.color.cardBorder}`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkCardBackground,
      borderColor: vars.color.darkCardBorder,
    },
  },
});

export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  padding: '8px 0',
  borderBottom: `1px solid ${vars.color.inputBorder}`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderBottomColor: vars.color.darkInputBorder,
    },
  },
});

export const title = style({
  fontSize: '18px',
  fontWeight: '600',
  color: vars.color.textPrimary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary,
    },
  },
});

export const agentCount = style({
  fontSize: '14px',
  color: vars.color.textTertiary,
  fontWeight: '400',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const agentsList = style({
  flex: '1 1 0',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 200px), 1fr))',
  gridAutoRows: 'minmax(64px, max-content)',
  alignContent: 'start',
  gap: '12px',
  marginBottom: '16px',
  minHeight: 0,
  maxHeight: 'none',
  overflowY: 'auto',
  padding: '8px',
});

export const agentCard = style({
  display: 'flex',
  alignItems: 'center',
  minHeight: '64px',
  padding: '12px',
  backgroundColor: vars.color.inputBackground,
  border: `1px solid ${vars.color.inputBorder}`,
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  ':hover': {
    backgroundColor: vars.color.inputHoverBackground,
    borderColor: vars.color.subtleBorder,
    transform: 'translateY(-1px)',
    boxShadow: vars.shadow.sm,
  },
  ':active': {
    transform: 'translateY(0)',
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkInputBorder,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground,
      borderColor: vars.color.darkSubtleBorder,
    },
  },
});

export const agentIcon = style({
  width: '24px',
  height: '24px',
  marginRight: '12px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

export const agentInfo = style({
  flex: 1,
  minWidth: 0,
});

export const agentId = style({
  fontSize: '14px',
  fontWeight: '500',
  color: vars.color.textPrimary,
  marginBottom: '4px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary,
    },
  },
});

export const agentMeta = style({
  fontSize: '12px',
  color: vars.color.textTertiary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const searchBox = style({
  padding: '8px 12px',
  border: `1px solid ${vars.color.subtleBorder}`,
  borderRadius: '4px',
  fontSize: '14px',
  marginBottom: '16px',
  outline: 'none',
  backgroundColor: vars.color.inputBackground,
  color: vars.color.foreground,
  ':focus': {
    borderColor: vars.color.primary,
    boxShadow: `0 0 0 1px ${vars.color.primary}`,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkSubtleBorder,
      color: vars.color.darkForeground,
    },
  },
});

export const clearButton = style({
  marginTop: '8px',
  padding: '4px 8px',
  border: `1px solid ${vars.color.subtleBorder}`,
  borderRadius: '4px',
  backgroundColor: vars.color.inputBackground,
  cursor: 'pointer',
  fontSize: '14px',
  color: vars.color.foreground,
  ':hover': {
    backgroundColor: vars.color.inputHoverBackground,
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkSubtleBorder,
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground,
    },
  },
});
