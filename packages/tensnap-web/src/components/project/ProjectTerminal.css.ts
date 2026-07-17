import { vars } from "@tensnap/web-common/styles/global.css";
import { globalStyle, style } from "@vanilla-extract/css";


export const projectContainer = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  padding: 0,
  background: vars.color.terminalBackground,
});

export const projectTerminal = style({
  width: '100%',
  height: '100%',
  background: vars.color.terminalBackground,
  color: vars.color.terminalForeground,
  overflowY: 'auto',
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  padding: vars.space.sm,

  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkTerminalBackground,
    },
  },
});

export const terminalToolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.sm,
  padding: vars.space.sm,
  borderBottom: `1px solid ${vars.color.border}`,
  fontSize: '0.8rem',
});

export const terminalCount = style({
  color: vars.color.textSecondary,
  marginRight: 'auto',
});

export const terminalControl = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  whiteSpace: 'nowrap',
});

export const clearButton = style({
  padding: '0.15rem 0.4rem',
  fontSize: '0.8rem',
});

export const terminalLogError = style({
  color: vars.color.terminalError,
});

export const terminalLogWarning = style({
  color: vars.color.terminalWarning,
});

export const terminalLogInfo = style({
  color: vars.color.terminalForeground,
  paddingBottom: '0.2rem',
  whiteSpace: 'pre-wrap',
});

export const terminalDetails = style({
  color: vars.color.textSecondary,
  margin: '0.15rem 0 0.35rem',
});

globalStyle(`${terminalDetails} pre`, {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: '0.2rem 0 0',
});

export const emptyTerminal = style({
  color: vars.color.textSecondary,
  margin: 0,
});

export const sidebar = style({
  width: '300px',
  backgroundColor: vars.color.gridBackground,
  borderRadius: vars.radius.md,
  padding: vars.space.md,
  height: 'fit-content',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkGridBackground,
    },
  },
});
