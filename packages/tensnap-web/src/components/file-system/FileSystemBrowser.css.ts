import { style } from '@vanilla-extract/css';

export const browserContainer = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: '#fafafa',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  overflow: 'hidden'
});

export const browserHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  backgroundColor: '#ffffff',
  borderBottom: '1px solid #e0e0e0',
  minHeight: '48px'
});

export const breadcrumbs = style({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '14px',
  color: '#666666'
});

export const breadcrumbSeparator = style({
  margin: '0 4px',
  color: '#999999'
});

export const breadcrumbItem = style({
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: '4px',
  transition: 'background-color 0.2s',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#f0f0f0'
    }
  }
});

export const breadcrumbCurrent = style([breadcrumbItem, {
  fontWeight: '500',
  color: '#333333',
  cursor: 'default',
  
  selectors: {
    '&:hover': {
      backgroundColor: 'transparent'
    }
  }
}]);

export const actionButtons = style({
  display: 'flex',
  gap: '8px',
  alignItems: 'center'
});

export const actionButton = style({
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1px solid #d0d0d0',
  backgroundColor: '#ffffff',
  color: '#333333',
  fontSize: '14px',
  cursor: 'pointer',
  transition: 'all 0.2s',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#f5f5f5',
      borderColor: '#b0b0b0'
    },
    
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.5
    },
    
    '&:disabled:hover': {
      backgroundColor: '#ffffff',
      borderColor: '#d0d0d0'
    }
  }
});

export const primaryButton = style([actionButton, {
  backgroundColor: '#0066cc',
  color: '#ffffff',
  borderColor: '#0066cc',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#0052a3'
    }
  }
}]);

export const browserContent = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
});

export const contentList = style({
  flex: 1,
  overflowY: 'auto',
  padding: '8px'
});

export const listItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 16px',
  borderRadius: '6px',
  cursor: 'pointer',
  transition: 'background-color 0.2s',
  border: '1px solid transparent',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#f0f4f8'
    }
  }
});

export const listItemSelected = style([listItem, {
  backgroundColor: '#e3f2fd',
  borderColor: '#2196f3'
}]);

export const itemIcon = style({
  width: '20px',
  height: '20px',
  flexShrink: 0,
  color: '#666666'
});

export const itemContent = style({
  flex: 1,
  minWidth: 0
});

export const itemName = style({
  fontSize: '14px',
  fontWeight: '500',
  color: '#333333',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
});

export const itemDetails = style({
  fontSize: '12px',
  color: '#666666',
  marginTop: '2px'
});

export const itemActions = style({
  display: 'flex',
  gap: '4px',
  opacity: 0,
  transition: 'opacity 0.2s',
  
  selectors: {
    [`${listItem}:hover &`]: {
      opacity: 1
    }
  }
});

export const itemActionButton = style({
  padding: '4px',
  borderRadius: '4px',
  border: 'none',
  backgroundColor: 'transparent',
  color: '#666666',
  cursor: 'pointer',
  transition: 'all 0.2s',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#e0e0e0',
      color: '#333333'
    }
  }
});

export const loadingState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  color: '#666666',
  fontSize: '14px'
});

export const errorState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  color: '#d32f2f',
  fontSize: '14px',
  textAlign: 'center'
});

export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  color: '#666666',
  fontSize: '14px',
  textAlign: 'center'
});

export const uploadArea = style({
  border: '2px dashed #d0d0d0',
  borderRadius: '8px',
  padding: '24px',
  margin: '16px',
  textAlign: 'center',
  backgroundColor: '#fafafa',
  transition: 'all 0.2s',
  cursor: 'pointer',
  
  selectors: {
    '&:hover': {
      borderColor: '#0066cc',
      backgroundColor: '#f0f4f8'
    }
  }
});

export const uploadAreaActive = style([uploadArea, {
  borderColor: '#0066cc',
  backgroundColor: '#e3f2fd'
}]);

export const uploadText = style({
  fontSize: '14px',
  color: '#666666',
  marginBottom: '8px'
});

export const uploadHint = style({
  fontSize: '12px',
  color: '#999999'
});

export const hiddenFileInput = style({
  display: 'none'
});

// Dropdown menu styles
export const dropdownContent = style({
  backgroundColor: '#ffffff',
  border: '1px solid #e0e0e0',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  padding: '4px',
  minWidth: '150px',
  zIndex: 1000
});

export const dropdownContentSmall = style([dropdownContent, {
  minWidth: '120px'
}]);

export const dropdownItem = style({
  padding: '12px',
  fontSize: '14px',
  cursor: 'pointer',
  borderRadius: '4px',
  transition: 'background-color 0.2s',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#f5f5f5'
    }
  }
});

export const dropdownItemDanger = style([dropdownItem, {
  color: '#d32f2f',
  
  selectors: {
    '&:hover': {
      backgroundColor: '#ffebee'
    }
  }
}]);
