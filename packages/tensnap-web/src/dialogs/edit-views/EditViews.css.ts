import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@tensnap/web-common/styles/global.css';

// Disabled field style
export const disabledField = style({
  opacity: 0.6,
  cursor: 'not-allowed',
});

// Info display styles
export const infoText = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.foreground,
  opacity: 0.7,
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const editor = style({ fontSize: vars.fontSize.sm, lineHeight: 1.5 });
globalStyle(`${editor} p, ${editor} small`, { display: 'block', marginBottom: vars.space.md });

export const section = style({
  minWidth: 0,
  marginBottom: vars.space.md,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  padding: vars.space.md,
  selectors: { 'body[data-theme="dark"] &': { borderColor: vars.color.darkBorder } },
});
export const sectionTitle = style({ fontWeight: 600, padding: `0 ${vars.space.xs}` });
export const sectionSummary = style({
  cursor: 'pointer',
  fontWeight: 600,
  overflowWrap: 'anywhere',
});
export const sectionContent = style({ paddingTop: vars.space.md });
export const fields = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  gap: vars.space.md,
  marginBottom: vars.space.md,
});
export const fieldRow = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: vars.space.xs,
  minWidth: 0,
});
globalStyle(`${fieldRow} > fieldset, ${fields} > fieldset`, { marginBottom: 0, width: '100%' });
export const fieldSource = style({
  fontSize: vars.fontSize.xs,
  marginLeft: vars.space.sm,
  color: vars.color.textSecondary,
  selectors: { 'body[data-theme="dark"] &': { color: vars.color.darkTextSecondary } },
});
export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: vars.space.sm,
  marginBottom: vars.space.md,
});
export const inheritButton = style({
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.fontSize.xs,
});
export const declaration = style({
  marginTop: vars.space.md,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'monospace',
  fontSize: vars.fontSize.xs,
});
