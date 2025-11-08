import { style, keyframes } from '@vanilla-extract/css';
import { vars } from '../../styles/global.css';

// 动画关键帧
const overlayShow = keyframes({
  '0%': { opacity: 0 },
  '100%': { opacity: 1 },
});

const contentShow = keyframes({
  '0%': { 
    opacity: 0, 
    transform: 'translate(-50%, -48%) scale(0.96)' 
  },
  '100%': { 
    opacity: 1, 
    transform: 'translate(-50%, -50%) scale(1)' 
  },
});

const overlayHide = keyframes({
  '0%': { opacity: 1 },
  '100%': { opacity: 0 },
});

const contentHide = keyframes({
  '0%': { 
    opacity: 1, 
    transform: 'translate(-50%, -50%) scale(1)' 
  },
  '100%': { 
    opacity: 0, 
    transform: 'translate(-50%, -48%) scale(0.96)' 
  },
});

// Dialog Overlay 样式
export const dialogOverlay = style({
  backgroundColor: vars.color.overlayLight,
  position: 'fixed',
  inset: 0,
  zIndex: 30,
  animation: `${overlayShow} 200ms cubic-bezier(0.16, 1, 0.3, 1)`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.overlayDark,
    },
    '&[data-state="closed"]': {
      animation: `${overlayHide} 200ms cubic-bezier(0.16, 1, 0.3, 1)`,
    },
  },
});

// Dialog Content 基础样式
export const dialogContent = style({
  backgroundColor: vars.color.background,
  borderRadius: vars.radius.lg,
  boxShadow: `${vars.shadow.xl}, 0 0 0 1px ${vars.color.border}`,
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90vw',
  maxWidth: '450px',
  maxHeight: '85vh',
  padding: vars.space.lg,
  zIndex: 31,
  overflow: 'auto',
  animation: `${contentShow} 200ms cubic-bezier(0.16, 1, 0.3, 1)`,
  
  selectors: {
    '&:focus': {
      outline: 'none',
    },
    '&[data-state="closed"]': {
      animation: `${contentHide} 200ms cubic-bezier(0.16, 1, 0.3, 1)`,
    },
    // 暗色主题支持
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      boxShadow: `${vars.shadow.xl}, 0 0 0 1px ${vars.color.darkBorder}`,
    },
  },
});

// 大尺寸 Dialog Content
export const dialogContentLarge = style([dialogContent, {
  maxWidth: '600px',
  width: '95vw',
}]);

// 超大尺寸 Dialog Content（如文件浏览器）
export const dialogContentXLarge = style([dialogContent, {
  maxWidth: '90vw',
  width: '90vw',
  height: '80vh',
  maxHeight: '80vh',
  padding: 0,
}]);

// Dialog Title 样式
export const dialogTitle = style({
  margin: 0,
  fontSize: vars.fontSize.lg,
  fontWeight: '600',
  color: vars.color.foreground,
  marginBottom: vars.space.md,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

// Dialog Description 样式
export const dialogDescription = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.secondary,
  marginBottom: vars.space.md,
  lineHeight: 1.5,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

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

// Dialog 关闭按钮
export const dialogClose = style({
  position: 'absolute',
  top: vars.space.md,
  right: vars.space.md,
  padding: vars.space.sm,
  borderRadius: vars.radius.sm,
  border: 'none',
  backgroundColor: 'transparent',
  color: vars.color.secondary,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '32px',
  height: '32px',
  
  selectors: {
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      color: vars.color.foreground,
    },
    '&:focus': {
      outline: `2px solid ${vars.color.primary}`,
      outlineOffset: '2px',
    },
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

// Dialog 头部区域（带边框）
export const dialogHeader = style({
  padding: `${vars.space.lg} ${vars.space.lg} ${vars.space.md}`,
  borderBottom: `1px solid rgba(0, 0, 0, 0.1)`,
  marginBottom: vars.space.lg,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

// Dialog 主体内容区域
export const dialogBody = style({
  padding: `0 ${vars.space.lg}`,
  flex: 1,
  overflow: 'auto',
});

// Dialog 底部区域（按钮区域）
export const dialogFooter = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: vars.space.sm,
  marginTop: vars.space.lg,
  paddingTop: vars.space.md,
  borderTop: `1px solid rgba(0, 0, 0, 0.1)`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      borderTopColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

// 按钮样式
export const dialogButton = style({
  padding: `${vars.space.sm} ${vars.space.md}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.secondary}`,
  backgroundColor: vars.color.background,
  color: vars.color.foreground,
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  display: 'flex',
  alignItems: 'center',
  gap: vars.space.xs,
  
  selectors: {
    '&:hover': {
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderColor: vars.color.foreground,
    },
    '&:focus': {
      outline: `2px solid ${vars.color.primary}`,
      outlineOffset: '2px',
    },
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.5,
    },
    '&:disabled:hover': {
      backgroundColor: vars.color.background,
      borderColor: vars.color.secondary,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      color: vars.color.darkForeground,
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});

// 主要按钮样式
export const dialogButtonPrimary = style([dialogButton, {
  backgroundColor: vars.color.primary,
  color: vars.color.background,
  borderColor: vars.color.primary,
  
  selectors: {
    '&:hover': {
      backgroundColor: '#0052a3',
      borderColor: '#0052a3',
    },
    '&:disabled': {
      backgroundColor: vars.color.secondary,
      borderColor: vars.color.secondary,
    },
  },
}]);

// 危险按钮样式
export const dialogButtonDanger = style([dialogButton, {
  backgroundColor: vars.color.danger,
  color: vars.color.background,
  borderColor: vars.color.danger,
  
  selectors: {
    '&:hover': {
      backgroundColor: '#a30000',
      borderColor: '#a30000',
    },
  },
}]);

// 表单相关样式
export const dialogInput = style({
  width: '100%',
  padding: `${vars.space.sm} ${vars.space.md}`,
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.secondary}`,
  fontSize: vars.fontSize.sm,
  transition: 'border-color 0.2s ease',
  
  selectors: {
    '&:focus': {
      outline: 'none',
      borderColor: vars.color.primary,
      boxShadow: `0 0 0 2px rgba(0, 102, 204, 0.2)`,
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      color: vars.color.darkForeground,
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
  },
});

export const dialogLabel = style({
  display: 'block',
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  color: vars.color.foreground,
  marginBottom: vars.space.xs,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkForeground,
    },
  },
});

export const dialogFieldset = style({
  border: 'none',
  padding: 0,
  margin: 0,
  marginBottom: vars.space.md,
});

// 分隔符样式
export const dialogSeparator = style({
  height: '1px',
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
  margin: `${vars.space.md} 0`,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
  },
});
