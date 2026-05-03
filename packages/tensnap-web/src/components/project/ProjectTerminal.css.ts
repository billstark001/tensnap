import { vars } from "@tensnap/web-common/styles/global.css";
import { style } from "@vanilla-extract/css";


export const projectContainer = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  padding: 0,
});

export const projectTerminal = style({
  width: '100%',
  height: '100%',
  background: vars.color.terminalBackground,
  color: vars.color.terminalForeground,
  overflowY: 'auto',
  fontFamily: 'monospace',
  
  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkTerminalBackground,
    },
  },
});

export const terminalLogError = style({
  color: vars.color.terminalError,
});

export const terminalLogWarning = style({
  color: vars.color.terminalWarning,
});

export const terminalLogInfo = style({
  color: vars.color.terminalForeground,
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
