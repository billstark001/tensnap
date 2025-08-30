import { style } from '@vanilla-extract/css';

export const chartContainer = style({
  width: '100%'
});

export const exportButton = style({
  padding: '6px 12px',
  fontSize: '12px',
  background: '#f0f0f0',
  border: '1px solid #ddd',
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  
  ':hover': {
    background: '#e0e0e0'
  },
  
  ':active': {
    background: '#d0d0d0'
  }
});

export const buttonContainer = style({
  marginBottom: '10px'
});

export const chartViewContainer = style({
  width: '100%',
  height: '300px'
});
