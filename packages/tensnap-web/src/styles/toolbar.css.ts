import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from './global.css';

// 基础样式
export const toolbar = style({
  display: 'flex',
  flexDirection: 'column',
  borderBottom: `1px solid ${vars.color.gridLine}`,
  backgroundColor: vars.color.background,
});

// 菜单栏样式
export const menuBar = style({
  display: 'flex',
  alignItems: 'center',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderBottom: `1px solid ${vars.color.gridLine}`,
  backgroundColor: vars.color.background,
});

export const menuItem = style({
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.fontSize.sm,
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  borderRadius: vars.radius.sm,
  transition: 'background-color 0.2s',
  
  ':hover': {
    backgroundColor: vars.color.gridBackground,
  },
  
  ':focus': {
    outline: `2px solid ${vars.color.primary}`,
    outlineOffset: '2px',
  },
});

// 工具栏样式（参考NetLogo）
export const toolBarRow = style({
  display: 'flex',
  alignItems: 'center',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  gap: vars.space.xs,
  borderBottom: `1px solid ${vars.color.gridLine}`,
  backgroundColor: vars.color.gridBackground,
});

export const toolGroup = style({
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.xs,
  marginRight: vars.space.sm,
});

export const toolButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  backgroundColor: 'transparent',
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  transition: 'all 0.2s',
  
  ':hover': {
    backgroundColor: vars.color.background,
    borderColor: vars.color.primary,
  },
  
  ':active': {
    backgroundColor: vars.color.primary,
    color: '#ffffff',
  },
  
  ':disabled': {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
});

export const toolButtonVariants = styleVariants({
  active: [toolButton, {
    backgroundColor: vars.color.primary,
    color: '#ffffff',
    borderColor: vars.color.primary,
  }],
  default: [toolButton],
});

export const separator = style({
  width: '1px',
  height: '24px',
  backgroundColor: vars.color.gridLine,
  margin: `0 ${vars.space.xs}`,
});

// 标签页样式
export const tabsContainer = style({
  display: 'flex',
  alignItems: 'center',
  padding: `${vars.space.xs} ${vars.space.sm} 0 ${vars.space.sm}`,
  backgroundColor: vars.color.background,
  gap: vars.space.xs,
});

export const tab = style({
  display: 'flex',
  alignItems: 'center',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.fontSize.sm,
  backgroundColor: vars.color.gridBackground,
  border: `1px solid ${vars.color.gridLine}`,
  borderBottom: 'none',
  borderRadius: `${vars.radius.sm} ${vars.radius.sm} 0 0`,
  cursor: 'pointer',
  transition: 'all 0.2s',
  maxWidth: '200px',
  
  ':hover': {
    backgroundColor: vars.color.background,
  },
});

export const activeTab = style([tab, {
  backgroundColor: vars.color.background,
  borderColor: vars.color.primary,
  color: vars.color.primary,
}]);

export const tabCloseButton = style({
  marginLeft: vars.space.xs,
  padding: '2px',
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  fontSize: '12px',
  opacity: 0.7,
  
  ':hover': {
    opacity: 1,
    backgroundColor: vars.color.danger,
    color: '#ffffff',
  },
});

export const newTabButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '28px',
  height: '28px',
  backgroundColor: 'transparent',
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  fontSize: '16px',
  transition: 'all 0.2s',
  
  ':hover': {
    backgroundColor: vars.color.primary,
    color: '#ffffff',
    borderColor: vars.color.primary,
  },
});

// 主题切换按钮样式
export const themeToggle = style({
  marginLeft: 'auto',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  backgroundColor: 'transparent',
  border: 'none',
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  fontSize: '16px',
  transition: 'background-color 0.2s',
  
  ':hover': {
    backgroundColor: vars.color.gridBackground,
  },
});

// 下拉菜单样式
export const dropdownContent = style({
  backgroundColor: vars.color.background,
  border: `1px solid ${vars.color.gridLine}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.sm,
  padding: vars.space.xs,
  minWidth: '160px',
});

export const dropdownItem = style({
  padding: `${vars.space.xs} ${vars.space.sm}`,
  fontSize: vars.fontSize.sm,
  cursor: 'pointer',
  borderRadius: vars.radius.sm,
  transition: 'background-color 0.2s',
  
  ':hover': {
    backgroundColor: vars.color.gridBackground,
  },
  
  ':focus': {
    outline: 'none',
    backgroundColor: vars.color.gridBackground,
  },
});

export const dropdownSeparator = style({
  height: '1px',
  backgroundColor: vars.color.gridLine,
  margin: `${vars.space.xs} 0`,
});

export const tooltipContent = style({
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  color: '#ffffff',
  padding: `${vars.space.xs} ${vars.space.sm}`,
  borderRadius: vars.radius.sm,
  fontSize: vars.fontSize.xs,
});
