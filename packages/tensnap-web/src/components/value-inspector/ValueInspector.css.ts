import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  minWidth: 0,
  border: `1px solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.sm,
  background: vars.color.inputHoverBackground,
  color: vars.color.foreground,
  overflow: 'hidden',
  selectors: {
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkInputBorder,
      background: vars.color.darkInputHoverBackground,
      color: vars.color.darkForeground,
    },
  },
});

export const compact = style({ fontSize: vars.fontSize.xs });

export const breadcrumbs = style({
  display: 'flex',
  gap: vars.space.xs,
  flexWrap: 'wrap',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderBottom: `1px solid ${vars.color.inputBorder}`,
  selectors: { 'body[data-theme="dark"] &': { borderBottomColor: vars.color.darkInputBorder } },
});

export const breadcrumb = style({
  appearance: 'none',
  border: 0,
  background: 'transparent',
  padding: 0,
  color: vars.color.primary,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 'inherit',
  selectors: { '&:not(:last-child)::after': { content: ' /', color: vars.color.secondary } },
});

export const raw = style({
  margin: 0,
  padding: vars.space.sm,
  maxHeight: '320px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
  fontSize: 'inherit',
  lineHeight: 1.45,
});

export const tree = style({ maxHeight: '320px', overflow: 'auto' });
export const treeRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(96px, 35%) minmax(0, 1fr)',
  gap: vars.space.sm,
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderBottom: `1px solid ${vars.color.inputBorder}`,
  selectors: { 'body[data-theme="dark"] &': { borderBottomColor: vars.color.darkInputBorder } },
});
export const treeKey = style({
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'monospace',
  fontWeight: 600,
});
export const treeValue = style({
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'monospace',
});
export const expandButton = style({
  display: 'inline-flex',
  minWidth: 0,
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: vars.space.xs,
  border: 0,
  background: 'transparent',
  color: vars.color.primary,
  cursor: 'pointer',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'monospace',
  fontSize: 'inherit',
});

export const tableScroll = style({ maxHeight: '320px', overflow: 'auto' });
export const virtualTable = style({
  minWidth: '100%',
  fontFamily: 'monospace',
  fontSize: 'inherit',
});
export const virtualHeader = style({
  display: 'grid',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: vars.color.inputBackground,
  selectors: { 'body[data-theme="dark"] &': { background: vars.color.darkInputBackground } },
});
export const virtualHeaderCell = style({
  padding: vars.space.xs,
  minWidth: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontWeight: 600,
});
export const virtualRow = style({
  display: 'grid',
  minHeight: '28px',
  borderTop: `1px solid ${vars.color.inputBorder}`,
  selectors: { 'body[data-theme="dark"] &': { borderTopColor: vars.color.darkInputBorder } },
});
export const virtualCell = style({
  padding: vars.space.xs,
  minWidth: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});

export const pagination = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: vars.space.xs,
  padding: vars.space.xs,
  borderTop: `1px solid ${vars.color.inputBorder}`,
  fontVariantNumeric: 'tabular-nums',
  selectors: { 'body[data-theme="dark"] &': { borderTopColor: vars.color.darkInputBorder } },
});
globalStyle(`${pagination} button`, {
  display: 'inline-flex',
  border: 0,
  background: 'transparent',
  color: vars.color.primary,
  cursor: 'pointer',
});
globalStyle(`${pagination} button:disabled`, { opacity: 0.45, cursor: 'not-allowed' });
export const notice = style({ margin: 0, padding: vars.space.sm, color: vars.color.secondary });
