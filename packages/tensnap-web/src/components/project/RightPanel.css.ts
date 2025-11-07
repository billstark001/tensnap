import { vars } from "@/styles/global.css";
import { style } from "@vanilla-extract/css";

export const rightPanel = style({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: vars.color.background,
  borderLeft: `1px solid ${vars.color.gridLine}`,
  overflow: 'hidden',
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      borderLeftColor: vars.color.darkGridLine,
    },
  },
});

export const panelHeader = style({
  padding: vars.space.md,
  borderBottom: `1px solid ${vars.color.gridLine}`,
  backgroundColor: vars.color.gridBackground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderBottomColor: vars.color.darkGridLine,
    },
  },
});

export const panelContent = style({
  padding: vars.space.md,
  overflowY: 'auto',
  flex: 1,
});
