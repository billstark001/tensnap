import { vars } from "@/styles/global.css";
import { style, globalStyle } from "@vanilla-extract/css";


export const projectContainer = style({
  width: '100%',
  height: '100%',
  minHeight: '50vh',
  overflow: 'hidden',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const mainContent = style({
  flex: 1,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

export const panelWrapper = style({
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

export const fullPanel = style({
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flex: 1,
  justifyContent: 'stretch',
  alignItems: 'stretch',
});

export const projectTerminal = style({
  background: vars.color.terminalBackground,
  color: vars.color.terminalForeground,
  overflow: 'auto',
  
  selectors: {
    'body[data-theme="dark"] &': {
      background: vars.color.darkTerminalBackground,
    },
  },
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

// Split panel styles
globalStyle('.split-horizontal', {
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
  width: '100%',
});

globalStyle('.split-vertical', {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
});

globalStyle('.gutter', {
  backgroundColor: vars.color.gridLine,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: '50%',
});

globalStyle('.gutter:hover', {
  backgroundColor: vars.color.secondary,
});

globalStyle('body[data-theme="dark"] .gutter', {
  backgroundColor: vars.color.darkGridLine,
});

globalStyle('body[data-theme="dark"] .gutter:hover', {
  backgroundColor: vars.color.darkSecondary,
});

globalStyle('.gutter.gutter-horizontal', {
  cursor: 'col-resize',
  width: '4px',
});

globalStyle('.gutter.gutter-vertical', {
  cursor: 'row-resize',
  height: '4px',
});
