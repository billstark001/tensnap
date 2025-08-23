import { globalStyle, createGlobalTheme } from '@vanilla-extract/css';

export const vars = createGlobalTheme(':root', {
  color: {
    background: '#ffffff',
    foreground: '#000000',
    primary: '#0066cc',
    secondary: '#6c757d',
    success: '#00cc66',
    danger: '#cc0000',
    warning: '#ffcc00',
    info: '#00cccc',
    
    // Dark mode colors
    darkBackground: '#1a1a1a',
    darkForeground: '#ffffff',
    darkSecondary: '#2a2a2a',
    darkTertiary: '#3a3a3a',
    
    // Grid colors
    gridLine: '#dddddd',
    gridBackground: '#f0f0f0',
    darkGridLine: 'rgba(255, 255, 255, 0.2)',
    darkGridBackground: '#2a2a2a',
  },
  space: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  fontSize: {
    xs: '12px',
    sm: '14px',
    md: '16px',
    lg: '18px',
    xl: '24px',
    xxl: '32px',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
    full: '9999px',
  },
  shadow: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.1)',
  },
});

globalStyle('*, *::before, *::after', {
  boxSizing: 'border-box',
  margin: 0,
  padding: 0,
});

globalStyle('html, body', {
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontSize: vars.fontSize.md,
  lineHeight: 1.5,
  color: vars.color.foreground,
  backgroundColor: vars.color.background,
});

globalStyle('body[data-theme="dark"]', {
  color: vars.color.darkForeground,
  backgroundColor: vars.color.darkBackground,
});

globalStyle('a', {
  color: vars.color.primary,
  textDecoration: 'none',
});

globalStyle('a:hover', {
  textDecoration: 'underline',
});