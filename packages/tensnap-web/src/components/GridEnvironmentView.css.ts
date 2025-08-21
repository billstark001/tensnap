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

export const dialogOverlay = style({
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
});

export const dialogContent = style({
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: 'hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px',
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: '90vw',
  maxWidth: '450px',
  maxHeight: '85vh',
  padding: '25px',
  zIndex: 1001,
  overflow: 'auto',
  ':focus': {
    outline: 'none'
  }
});

export const dialogTitle = style({
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
  color: 'hsl(210, 12%, 15%)'
});

export const dialogDescription = style({
  margin: '10px 0 20px',
  color: 'hsl(210, 6%, 50%)',
  fontSize: '15px',
  lineHeight: 1.5
});

export const dialogText = style({
  margin: '8px 0',
  fontSize: '14px'
});

export const dialogPre = style({
  background: '#f5f5f5',
  padding: '8px',
  borderRadius: '4px',
  fontSize: '12px',
  overflow: 'auto',
  maxHeight: '200px'
});

export const dialogCloseButton = style({
  marginTop: '16px',
  padding: '8px 16px',
  background: '#007bff',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: '500',
  ':hover': {
    background: '#0056b3'
  },
  ':focus': {
    outline: '2px solid #007bff',
    outlineOffset: '2px'
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