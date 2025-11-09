import { style } from '@vanilla-extract/css';
import { vars } from 'tensnap-web/styles/global.css';

export const browserContainer = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: vars.color.background,
  border: `1px solid ${vars.color.border}`,
  borderRadius: vars.radius.md,
  overflow: 'hidden',
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkBackground,
      borderColor: vars.color.darkBorder,
    },
  },
});

export const browserHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 16px',
  backgroundColor: vars.color.background,
  borderBottom: `1px solid ${vars.color.border}`,
  minHeight: '48px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderBottomColor: vars.color.darkBorder,
    },
  },
});

export const breadcrumbs = style({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: vars.fontSize.sm,
  color: vars.color.textTertiary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary,
    },
  },
});

export const breadcrumbSeparator = style({
  margin: '0 4px',
  color: vars.color.textSecondary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary,
    },
  },
});

export const breadcrumbItem = style({
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: vars.radius.sm,
  transition: 'background-color 0.2s',
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.verySubtleBackground
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkVerySubtleBackground
    }
  }
});

export const breadcrumbCurrent = style([breadcrumbItem, {
  fontWeight: '500',
  color: vars.color.textPrimary,
  cursor: 'default',
  
  selectors: {
    '&:hover': {
      backgroundColor: 'transparent'
    },
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary
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
  borderRadius: vars.radius.sm,
  border: `1px solid ${vars.color.inputBorder}`,
  backgroundColor: vars.color.inputBackground,
  color: vars.color.textPrimary,
  fontSize: vars.fontSize.sm,
  cursor: 'pointer',
  transition: 'all 0.2s',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.inputHoverBackground,
      borderColor: vars.color.subtleBorder
    },
    
    '&:disabled': {
      cursor: 'not-allowed',
      opacity: 0.5
    },
    
    '&:disabled:hover': {
      backgroundColor: vars.color.inputBackground,
      borderColor: vars.color.inputBorder
    },
    
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkInputBorder,
      color: vars.color.darkTextPrimary
    },
    
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground,
      borderColor: vars.color.darkSubtleBorder
    },
    
    'body[data-theme="dark"] &:disabled:hover': {
      backgroundColor: vars.color.darkInputBackground,
      borderColor: vars.color.darkInputBorder
    }
  }
});

export const primaryButton = style([actionButton, {
  backgroundColor: vars.color.primary,
  color: vars.color.background,
  borderColor: vars.color.primary,
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.primaryHover
    },
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.primary,
      color: vars.color.darkForeground,
      borderColor: vars.color.primary
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.primaryHover
    }
  }
}]);

export const browserContent = style({
  flex: 1,
  display: 'flex',
  height: 'max-content',
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
  borderRadius: vars.radius.sm,
  cursor: 'pointer',
  transition: 'background-color 0.2s',
  border: '1px solid transparent',
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.cardHoverBackground
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkCardHoverBackground
    }
  }
});

export const listItemSelected = style([listItem, {
  backgroundColor: vars.color.cardHoverBackground,
  borderColor: vars.color.primary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkCardHoverBackground,
      borderColor: vars.color.primary
    }
  }
}]);

export const itemIcon = style({
  width: '20px',
  height: '20px',
  flexShrink: 0,
  color: vars.color.textTertiary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    }
  }
});

export const itemContent = style({
  flex: 1,
  minWidth: 0
});

export const itemName = style({
  fontSize: vars.fontSize.sm,
  fontWeight: '500',
  color: vars.color.textPrimary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary
    }
  }
});

export const itemDetails = style({
  fontSize: vars.fontSize.xs,
  color: vars.color.textTertiary,
  marginTop: '2px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    }
  }
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
  borderRadius: vars.radius.sm,
  border: 'none',
  backgroundColor: 'transparent',
  color: vars.color.textTertiary,
  cursor: 'pointer',
  transition: 'all 0.2s',
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.verySubtleBackground,
      color: vars.color.textPrimary
    },
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkVerySubtleBackground,
      color: vars.color.darkTextPrimary
    }
  }
});

export const loadingState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  color: vars.color.textTertiary,
  fontSize: vars.fontSize.sm,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    }
  }
});

export const errorState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  color: vars.color.danger,
  fontSize: vars.fontSize.sm,
  textAlign: 'center'
});

export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '48px 32px',
  color: vars.color.textTertiary,
  fontSize: vars.fontSize.sm,
  textAlign: 'center',
  gap: '16px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    }
  }
});

export const emptyStateIcon = style({
  fontSize: '48px',
  opacity: 0.5
});

export const emptyStateText = style({
  fontSize: vars.fontSize.md,
  fontWeight: '500',
  color: vars.color.textTertiary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    }
  }
});

export const uploadArea = style({
  border: `2px dashed ${vars.color.inputBorder}`,
  borderRadius: vars.radius.md,
  padding: '24px',
  margin: '16px',
  textAlign: 'center',
  backgroundColor: vars.color.subtleBackground,
  transition: 'all 0.2s',
  cursor: 'pointer',
  
  selectors: {
    '&:hover': {
      borderColor: vars.color.primary,
      backgroundColor: vars.color.cardHoverBackground
    },
    'body[data-theme="dark"] &': {
      borderColor: vars.color.darkInputBorder,
      backgroundColor: vars.color.darkSubtleBackground
    },
    'body[data-theme="dark"] &:hover': {
      borderColor: vars.color.primary,
      backgroundColor: vars.color.darkCardHoverBackground
    }
  }
});

export const uploadAreaActive = style([uploadArea, {
  borderColor: vars.color.primary,
  backgroundColor: vars.color.cardHoverBackground,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkCardHoverBackground
    }
  }
}]);

export const uploadText = style({
  fontSize: vars.fontSize.sm,
  color: vars.color.textTertiary,
  marginBottom: '8px',
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextTertiary
    }
  }
});

export const uploadHint = style({
  fontSize: vars.fontSize.xs,
  color: vars.color.textSecondary,
  
  selectors: {
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextSecondary
    }
  }
});

export const hiddenFileInput = style({
  display: 'none'
});

// Dropdown menu styles
export const dropdownContent = style({
  backgroundColor: vars.color.background,
  border: `1px solid ${vars.color.inputBorder}`,
  borderRadius: vars.radius.md,
  boxShadow: vars.shadow.md,
  padding: '4px',
  minWidth: '150px',
  zIndex: 1000,
  
  selectors: {
    'body[data-theme="dark"] &': {
      backgroundColor: vars.color.darkSecondary,
      borderColor: vars.color.darkInputBorder
    }
  }
});

export const dropdownContentSmall = style([dropdownContent, {
  minWidth: '120px'
}]);

export const dropdownItem = style({
  padding: '12px',
  fontSize: vars.fontSize.sm,
  cursor: 'pointer',
  borderRadius: vars.radius.sm,
  transition: 'background-color 0.2s',
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.inputHoverBackground
    },
    'body[data-theme="dark"] &': {
      color: vars.color.darkTextPrimary
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkInputHoverBackground
    }
  }
});

export const dropdownItemDanger = style([dropdownItem, {
  color: vars.color.danger,
  
  selectors: {
    '&:hover': {
      backgroundColor: vars.color.cardHoverBackground
    },
    'body[data-theme="dark"] &': {
      color: vars.color.danger
    },
    'body[data-theme="dark"] &:hover': {
      backgroundColor: vars.color.darkCardHoverBackground
    }
  }
}]);
