// GridEnvironmentView.css.ts
import { style } from '@vanilla-extract/css';

export const container = style({
  position: 'relative'
});

export const canvas = style({
  border: '1px solid #cccccc',
  borderRadius: '4px',
  cursor: 'crosshair'
});

export const contextMenu = style({
  position: 'fixed',
  background: 'white',
  border: '1px solid #ccc',
  borderRadius: '4px',
  padding: '4px 0',
  boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  zIndex: 999
});

export const contextMenuItem = style({
  padding: '8px 16px',
  cursor: 'pointer',
  fontSize: '14px',
  ':hover': {
    background: '#f0f0f0'
  }
});