import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const root = style({
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
  appearance: 'none', border: 0, background: 'transparent', padding: 0, color: vars.color.primary,
  cursor: 'pointer', fontFamily: 'monospace', fontSize: 'inherit',
  selectors: { '&:not(:last-child)::after': { content: ' /', color: vars.color.secondary } },
});

export const raw = style({
  margin: 0, padding: vars.space.sm, maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  fontFamily: 'Monaco, Consolas, "Courier New", monospace', fontSize: 'inherit', lineHeight: 1.45,
});

export const tree = style({ maxHeight: '320px', overflow: 'auto' });
export const treeRow = style({ display: 'grid', gridTemplateColumns: 'minmax(96px, 35%) minmax(0, 1fr)', gap: vars.space.sm, padding: `${vars.space.xs} ${vars.space.sm}`, borderBottom: `1px solid ${vars.color.inputBorder}`, selectors: { 'body[data-theme="dark"] &': { borderBottomColor: vars.color.darkInputBorder } } });
export const treeKey = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600 });
export const treeValue = style({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' });
export const expandButton = style({ display: 'inline-flex', minWidth: 0, justifyContent: 'space-between', alignItems: 'center', gap: vars.space.xs, border: 0, background: 'transparent', color: vars.color.primary, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 'inherit' });

export const tableScroll = style({ maxHeight: '320px', overflow: 'auto' });
export const virtualTable = style({ position: 'relative', minWidth: '100%' });
export const virtualHeader = style({
  position: 'sticky', top: 0, zIndex: 2, height: '28px',
  background: vars.color.inputBackground,
  selectors: { 'body[data-theme="dark"] &': { background: vars.color.darkInputBackground } },
});
export const virtualHeaderCell = style({
  position: 'absolute', top: 0, height: '28px', padding: vars.space.xs,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600,
});
export const virtualRow = style({ position: 'absolute', left: 0, height: '28px', minWidth: '100%' });
export const virtualCell = style({
  position: 'absolute', top: 0, height: '28px', padding: vars.space.xs,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  borderTop: `1px solid ${vars.color.inputBorder}`,
  selectors: { 'body[data-theme="dark"] &': { borderTopColor: vars.color.darkInputBorder } },
});
export const table = style({ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 'inherit' });
globalStyle(`${table} th`, { position: 'sticky', top: 0, background: vars.color.inputBackground, textAlign: 'left', padding: vars.space.xs });
globalStyle(`${table} td`, { maxWidth: '240px', padding: vars.space.xs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderTop: `1px solid ${vars.color.inputBorder}` });
globalStyle(`body[data-theme="dark"] ${table} th`, { background: vars.color.darkInputBackground });
globalStyle(`body[data-theme="dark"] ${table} td`, { borderTopColor: vars.color.darkInputBorder });

export const pagination = style({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: vars.space.xs, padding: vars.space.xs, borderTop: `1px solid ${vars.color.inputBorder}`, fontVariantNumeric: 'tabular-nums', selectors: { 'body[data-theme="dark"] &': { borderTopColor: vars.color.darkInputBorder } } });
globalStyle(`${pagination} button`, { display: 'inline-flex', border: 0, background: 'transparent', color: vars.color.primary, cursor: 'pointer' });
globalStyle(`${pagination} button:disabled`, { opacity: 0.45, cursor: 'not-allowed' });
export const notice = style({ margin: 0, padding: vars.space.sm, color: vars.color.secondary });
