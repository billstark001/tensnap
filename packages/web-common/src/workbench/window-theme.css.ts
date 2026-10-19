import { globalStyle } from '@vanilla-extract/css';
import { vars } from '../styles/global.css';

globalStyle('.tensnap-window', {
  background: vars.color.background,
  color: vars.color.foreground,
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.xl,
});
globalStyle('.tensnap-window .wb-header', {
  background: vars.color.gridBackground,
  color: vars.color.foreground,
  borderBottom: `1px solid ${vars.color.gridLine}`,
});
globalStyle('.tensnap-window .wb-header', {
  borderRadius: `${vars.radius.md} ${vars.radius.md} 0 0`,
});
globalStyle('.tensnap-window .wb-title', {
  fontFamily: 'inherit',
  fontSize: vars.fontSize.sm,
  fontWeight: 600,
});
globalStyle('.tensnap-window .wb-drag', { paddingLeft: vars.space.md });
globalStyle('.tensnap-window .wb-body', {
  background: vars.color.background,
  color: vars.color.foreground,
  borderRadius: `0 0 ${vars.radius.md} ${vars.radius.md}`,
});
globalStyle('.tensnap-window .wb-control', { marginRight: vars.space.xs });
globalStyle('.tensnap-window .wb-control > span', { outlineOffset: '-3px' });
globalStyle('.tensnap-window .wb-control > span:focus-visible', {
  outline: `2px solid ${vars.color.primary}`,
});
globalStyle('.tensnap-window .wb-max', { filter: 'invert(1)' });
globalStyle('.tensnap-window .wb-close', {
  backgroundImage: 'none',
  position: 'relative',
  color: 'inherit',
});
globalStyle('.tensnap-window .wb-close::before, .tensnap-window .wb-close::after', {
  content: '""',
  position: 'absolute',
  left: '50%',
  top: '50%',
  width: '13px',
  height: '1.5px',
  background: 'currentColor',
  transform: 'translate(-50%, -50%) rotate(45deg)',
});
globalStyle('.tensnap-window .wb-close::after', {
  transform: 'translate(-50%, -50%) rotate(-45deg)',
});
globalStyle('.tensnap-window .wb-close:hover', { color: vars.color.danger });
globalStyle('.tensnap-window.modal::after', {
  animation: 'none',
  opacity: 1,
  background: vars.color.overlayLight,
});
globalStyle('body[data-theme="dark"] .tensnap-window', {
  background: vars.color.darkBackground,
  color: vars.color.darkForeground,
  borderColor: vars.color.darkGridLine,
});
globalStyle('body[data-theme="dark"] .tensnap-window .wb-header', {
  background: vars.color.darkGridBackground,
  color: vars.color.darkForeground,
  borderBottomColor: vars.color.darkGridLine,
});
globalStyle('body[data-theme="dark"] .tensnap-window .wb-body', {
  background: vars.color.darkBackground,
  color: vars.color.darkForeground,
});
globalStyle('body[data-theme="dark"] .tensnap-window .wb-max', { filter: 'none' });
globalStyle('body[data-theme="dark"] .tensnap-window.modal::after', {
  background: vars.color.overlayDark,
});
// Modal focus/dismissal stays active while WinBox handles moving and resizing.
globalStyle(
  '.tensnap-window.modal:not(.max) .wb-body ~ div, .tensnap-window.modal:not(.max) .wb-drag',
  { pointerEvents: 'auto' },
);
