// GridEnvironmentView.css.ts
import { style } from '@vanilla-extract/css';

export const container = style({
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'auto',
});

export const canvas = style({
  cursor: 'crosshair',
  width: '100%',
  height: '100%',
  minWidth: '200px',
  minHeight: '200px',
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