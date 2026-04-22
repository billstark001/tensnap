// @/components/ui/Pagination.css.ts
import { style } from '@vanilla-extract/css';

export const pagination = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: '8px',
  paddingTop: '16px',
  borderTop: '1px solid #e0e0e0',
});

export const pageButton = style({
  padding: '6px 12px',
  backgroundColor: 'white',
  border: '1px solid #ccc',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  transition: 'all 0.2s ease',
  minWidth: '36px',
  textAlign: 'center',
  ':hover': {
    backgroundColor: '#f0f0f0',
    borderColor: '#999',
  },
  ':disabled': {
    backgroundColor: '#f5f5f5',
    color: '#999',
    cursor: 'not-allowed',
    borderColor: '#e0e0e0',
  },
});

export const pageButtonActive = style({
  backgroundColor: '#007acc',
  color: 'white',
  borderColor: '#007acc',
  ':hover': {
    backgroundColor: '#005a9e',
    borderColor: '#005a9e',
  },
});

export const pageInfo = style({
  fontSize: '14px',
  color: '#666',
  padding: '0 8px',
});