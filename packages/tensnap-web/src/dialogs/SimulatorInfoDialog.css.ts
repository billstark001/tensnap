import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const body = style({ display: 'grid', gap: vars.space.lg, maxHeight: '70vh', overflowY: 'auto' });
export const section = style({ display: 'grid', gap: vars.space.sm });
globalStyle(`${section} h3`, { margin: 0, fontSize: vars.fontSize.md });
export const details = style({ display: 'grid', gridTemplateColumns: 'minmax(108px, auto) minmax(0, 1fr)', gap: `${vars.space.xs} ${vars.space.md}`, margin: 0 });
globalStyle(`${details} dt`, { color: vars.color.secondary });
globalStyle(`${details} dd`, { margin: 0, overflowWrap: 'anywhere', fontFamily: 'monospace' });
export const description = style({ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
export const capabilities = style({ margin: 0, paddingLeft: vars.space.lg, fontFamily: 'monospace' });
export const empty = style({ margin: 0, color: vars.color.secondary });
