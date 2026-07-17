import { style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

export const body = style({ display: 'grid', gap: vars.space.md });
export const field = style({ display: 'grid', gap: vars.space.xs, color: vars.color.foreground, selectors: { 'body[data-theme="dark"] &': { color: vars.color.darkForeground } } });
export const warning = style({ margin: 0, padding: vars.space.sm, borderRadius: vars.radius.sm, background: '#fff3cd', color: '#664d03', selectors: { 'body[data-theme="dark"] &': { background: '#4a3d08', color: '#ffe69c' } } });
export const summary = style({ margin: 0, color: vars.color.secondary });
