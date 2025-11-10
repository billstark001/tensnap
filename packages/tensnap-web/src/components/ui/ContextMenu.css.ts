import { vars } from "@/styles/global.css";
import { globalStyle, style } from "@vanilla-extract/css";

export const contextMenu = style({
  backgroundColor: vars.color.inputBackground,
  borderRadius: '6px',
  boxShadow: vars.shadow.lg,
  padding: '4px',
  minWidth: '160px',
  border: `1px solid ${vars.color.inputBorder}`,

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkInputBorder,
    },
  },
});

export const contextMenuItem = style({
  display: 'flex',
  alignItems: 'center',
  padding: '8px 12px',
  fontSize: '14px',
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'background-color 0.1s',
  color: vars.color.foreground,
  ':hover': {
    backgroundColor: vars.color.verySubtleBackground,
  },

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkVerySubtleBackground,
    },
  },
});

globalStyle(`${contextMenuItem} > svg`, {
  width: '1.2em',
  height: '1.2em',
  marginRight: '8px',
});

export const contextMenuItemDanger = style([
  contextMenuItem,
  {
    color: vars.color.danger,
  },
]);

export const contextMenuLabel = style({
  padding: '8px 12px',
  fontSize: '12px',
  color: vars.color.textTertiary,

  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const contextMenuSeparator = style({
  height: '1px',
  backgroundColor: vars.color.border,
  margin: '4px 0',

  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBorder,
    },
  },
});
