// UniformEnvironmentView.css.ts
import { style } from '@vanilla-extract/css';

export const container = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: '16px',
  backgroundColor: '#f9f9f9',
  borderRadius: '8px',
  border: '1px solid #e0e0e0',
});

export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '16px',
  padding: '8px 0',
  borderBottom: '1px solid #e0e0e0',
});

export const title = style({
  fontSize: '18px',
  fontWeight: '600',
  color: '#333',
});

export const agentCount = style({
  fontSize: '14px',
  color: '#666',
  fontWeight: '400',
});

export const agentsList = style({
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '12px',
  marginBottom: '16px',
  minHeight: '200px',
  maxHeight: '400px',
  overflowY: 'auto',
  padding: '8px',
});

export const agentCard = style({
  display: 'flex',
  alignItems: 'center',
  padding: '12px',
  backgroundColor: 'white',
  border: '1px solid #e0e0e0',
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  ':hover': {
    backgroundColor: '#f5f5f5',
    borderColor: '#ccc',
    transform: 'translateY(-1px)',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  ':active': {
    transform: 'translateY(0)',
  },
});

export const agentIcon = style({
  width: '24px',
  height: '24px',
  marginRight: '12px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
});

export const agentInfo = style({
  flex: 1,
  minWidth: 0,
});

export const agentId = style({
  fontSize: '14px',
  fontWeight: '500',
  color: '#333',
  marginBottom: '4px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const agentMeta = style({
  fontSize: '12px',
  color: '#666',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const emptyState = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#666',
  fontSize: '14px',
  textAlign: 'center',
  gap: '8px',
});

export const emptyIcon = style({
  fontSize: '48px',
  opacity: 0.3,
});

export const searchBox = style({
  padding: '8px 12px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  fontSize: '14px',
  marginBottom: '16px',
  outline: 'none',
  ':focus': {
    borderColor: '#007acc',
    boxShadow: '0 0 0 1px #007acc',
  },
});

export const clearButton = style({
  marginTop: '8px',
  padding: '4px 8px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  backgroundColor: 'white',
  cursor: 'pointer',
  fontSize: '14px',
  ':hover': {
    backgroundColor: '#f5f5f5',
  },
});
