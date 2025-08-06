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

export const modal = style({
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'white',
  padding: '20px',
  borderRadius: '8px',
  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
  zIndex: 1000,
  maxWidth: '400px',
  maxHeight: '80vh',
  overflow: 'auto'
});

export const modalTitle = style({
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold'
});

export const modalText = style({
  margin: '8px 0',
  fontSize: '14px'
});

export const modalPre = style({
  background: '#f5f5f5',
  padding: '8px',
  borderRadius: '4px',
  fontSize: '12px',
  overflow: 'auto',
  maxHeight: '200px'
});

export const modalButton = style({
  marginTop: '16px',
  padding: '8px 16px',
  background: '#007bff',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  ':hover': {
    background: '#0056b3'
  }
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