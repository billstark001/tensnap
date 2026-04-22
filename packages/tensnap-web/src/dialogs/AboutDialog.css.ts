import { vars } from "@tensnap/web-common/styles/global.css";
import { style } from "@vanilla-extract/css";

export const aboutContainer = style({
  padding: `${vars.space.lg} 0`,
});

export const aboutHeader = style({
  textAlign: 'center',
  marginBottom: vars.space.lg,
});

export const aboutTitle = style({
  fontSize: vars.fontSize.xxl,
  fontWeight: 'bold',
  marginBottom: vars.space.sm,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const aboutVersion = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.textSecondary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
  },
});

export const aboutDescription = style({
  marginBottom: vars.space.md,
});

export const aboutText = style({
  fontSize: vars.fontSize.sm,
  lineHeight: 1.6,
  marginBottom: vars.space.md,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const aboutLinks = style({
  marginTop: vars.space.lg,
  borderTop: `1px solid ${vars.color.border}`,
  paddingTop: vars.space.md,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderTopColor: vars.color.darkBorder,
    },
  },
});

export const aboutLinkItem = style({
  marginBottom: vars.space.md,
  color: vars.color.foreground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const aboutLink = style({
  color: vars.color.link,
  textDecoration: 'none',
  
  ':hover': {
    textDecoration: 'underline',
  },
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkLink,
    },
  },
});

export const aboutFooter = style({
  marginTop: vars.space.lg,
  fontSize: vars.fontSize.xs,
  color: vars.color.textSecondary,
  textAlign: 'center',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
  },
});
