import { globalStyle } from '@vanilla-extract/css';
import { vars } from '../styles/global.css';

globalStyle('.content-island', {
  boxSizing: 'border-box',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  padding: vars.space.md,
  position: 'relative',
  outline: 'none',
});

globalStyle('[data-workbench-menu]', {
  position: 'fixed',
  zIndex: 100000,
  maxHeight: 'min(80vh, 600px)',
  maxWidth: 'calc(100vw - 8px)',
  overflow: 'hidden',
});

globalStyle("[data-workbench-menu] [role='menuitem']:focus", {
  outline: '2px solid #5c9be8',
  outlineOffset: '-2px',
});

globalStyle("[data-workbench-menu] [role='menu']", {
  display: 'flex',
  flexDirection: 'column',
});

globalStyle('.workbench-shell', {
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
});

globalStyle('.workbench-workspace', {
  flex: 1,
  minHeight: 0,
});

globalStyle('.workbench-split', {
  display: 'flex',
  width: '100%',
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
});

globalStyle(".workbench-split[data-axis='vertical']", {
  flexDirection: 'column',
});

globalStyle('.workbench-split > [data-panel]', {
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});

globalStyle('.workbench-divider', {
  flex: '0 0 4px',
  background: '#9995',
  border: 0,
  padding: 0,
  cursor: 'col-resize',
  touchAction: 'none',
});

globalStyle("[data-axis='vertical'] > .workbench-divider", {
  cursor: 'row-resize',
});

globalStyle("[data-workbench-menu] [role='menuitem']", {
  width: '100%',
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  font: 'inherit',
});

globalStyle("[data-workbench-menu] [role='menuitem']:disabled", {
  opacity: '0.5',
  cursor: 'default',
});

globalStyle(".content-island[data-dialog-size='full']", {
  display: 'flex',
  flexDirection: 'column',
});

globalStyle('[data-titlebar-overlay] [data-workbench-menubar]', {
  paddingLeft: '80px',
  minHeight: '36px',
  userSelect: 'none',
});

globalStyle('.native-content-window', {
  position: 'fixed',
  inset: 0,
  height: 'auto',
  background: 'inherit',
});
