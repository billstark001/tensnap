import { style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const detailRow = style({
  margin: '8px 0',
  fontSize: '14px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const detailLabel = style({
  fontWeight: 'bold',
  minWidth: '80px',
  color: vars.color.textTertiary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const colorSwatch = style({
  width: '16px',
  height: '16px',
  borderRadius: '2px',
  border: `1px solid ${vars.color.subtleBorder}`,
  display: 'inline-block',
  marginRight: '8px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkSubtleBorder,
    },
  },
});

export const dataSection = style({
  marginTop: '16px',
});

export const dataSectionTitle = style({
  margin: '16px 0 8px 0',
  fontSize: '14px',
  fontWeight: 'bold',
  color: vars.color.textPrimary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary,
    },
  },
});

export const dataContent = style({
  backgroundColor: vars.color.inputHoverBackground,
  padding: '8px',
  borderRadius: '4px',
  fontSize: '12px',
  overflow: 'auto',
  maxHeight: '200px',
  border: `1px solid ${vars.color.inputBorder}`,
  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputHoverBackground,
      borderColor: vars.color.darkInputBorder,
      color: vars.color.darkForeground,
    },
  },
});

export const positionInfo = style({
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
});

export const headingInfo = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

export const trajectoryInfo = style({
  marginTop: '8px',
  fontSize: '12px',
  color: vars.color.textTertiary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const agentIcon = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: '8px',
  minWidth: '24px',
  height: '24px',
});

export const iconWrapper = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const iconCircle = style({
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.color.terminalForeground,
  fontWeight: 'bold',
  fontSize: '12px',
});

export const iconSquare = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.color.terminalForeground,
  fontWeight: 'bold',
  fontSize: '12px',
});

export const iconTriangle = style({
  width: 0,
  height: 0,
  borderLeft: '12px solid transparent',
  borderRight: '12px solid transparent',
  borderBottom: '20px solid',
});

export const iconArrow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: vars.color.terminalForeground,
  fontWeight: 'bold',
  fontSize: '12px',
});