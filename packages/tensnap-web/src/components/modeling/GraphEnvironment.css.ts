import { style } from '@vanilla-extract/css';

export const container = style({
  position: 'relative',
});

export const svg = style({
  border: '1px solid #cccccc',
  borderRadius: '4px',
  background: '#fafafa',
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
  overflow: 'auto',
});

export const modalTitle = style({
  margin: '0 0 16px 0',
  fontSize: '18px',
  fontWeight: 'bold',
});

export const modalProperty = style({
  margin: '8px 0',
  fontSize: '14px',
});

export const modalCode = style({
  background: '#f5f5f5',
  padding: '8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontFamily: 'monospace',
  overflow: 'auto',
  maxHeight: '200px',
});

export const closeButton = style({
  marginTop: '16px',
  padding: '8px 16px',
  background: '#007acc',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  ':hover': {
    background: '#005a9e',
  },
});

export const nodeText = style({
  textAnchor: 'middle',
  dominantBaseline: 'middle',
  fontSize: '10px',
  fill: 'white',
  pointerEvents: 'none',
  userSelect: 'none',
});
