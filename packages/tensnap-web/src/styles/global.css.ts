import { globalStyle, createGlobalTheme } from '@vanilla-extract/css';

export const vars = createGlobalTheme(':root', {
  color: {
    background: '#ffffff',
    foreground: '#000000',
    primary: '#0066cc',
    primaryHover: '#0052a3',
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
    
    // Terminal colors
    terminalBackground: '#1e1e1e',
    terminalForeground: '#ffffff',
    terminalError: '#f44747',
    terminalWarning: '#ffcc00',
    darkTerminalBackground: '#0a0a0a',
    
    // Overlay colors
    overlayLight: 'rgba(0, 0, 0, 0.5)',
    overlayDark: 'rgba(0, 0, 0, 0.7)',
    
    // Border colors
    border: 'rgba(0, 0, 0, 0.1)',
    darkBorder: 'rgba(255, 255, 255, 0.1)',
    
    // Text colors
    textSecondary: '#6c757d',
    darkTextSecondary: '#aaaaaa',
    
    // Link colors
    link: '#0066cc',
    darkLink: '#4da6ff',
    
    // UI element colors
    inputBorder: '#e0e0e0',
    inputBackground: '#ffffff',
    inputHoverBackground: '#f5f5f5',
    darkInputBorder: 'rgba(255, 255, 255, 0.2)',
    darkInputBackground: '#2a2a2a',
    darkInputHoverBackground: '#3a3a3a',
    
    // Card colors
    cardBackground: '#f9f9f9',
    cardBorder: '#e0e0e0',
    cardHoverBackground: '#f5f5f5',
    darkCardBackground: '#2a2a2a',
    darkCardBorder: 'rgba(255, 255, 255, 0.15)',
    darkCardHoverBackground: '#3a3a3a',
    
    // Subtle colors
    subtleBorder: '#cccccc',
    subtleBackground: '#fafafa',
    verySubtleBackground: '#f0f0f0',
    darkSubtleBorder: 'rgba(255, 255, 255, 0.15)',
    darkSubtleBackground: '#1e1e1e',
    darkVerySubtleBackground: '#2e2e2e',
    
    // Text color variations
    textPrimary: '#333333',
    textTertiary: '#666666',
    darkTextPrimary: '#e0e0e0',
    darkTextTertiary: '#999999',
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