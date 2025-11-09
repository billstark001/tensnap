import { style } from '@vanilla-extract/css';
import { vars } from '@/styles/global.css';

export const guidelinesContainer = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 9999,
  overflow: 'hidden',
});

export const guidelineBase = style({
  position: 'absolute',
  pointerEvents: 'none',
});

export const verticalGuideline = style([
  guidelineBase,
  {
    width: '1px',
    height: '100%',
    top: 0,
  },
]);

export const horizontalGuideline = style([
  guidelineBase,
  {
    height: '1px',
    width: '100%',
    left: 0,
  },
]);

export const guidelineSegment = style({
  position: 'absolute',
  backgroundColor: vars.color.primary,
  opacity: 0.8,
  transition: 'opacity 0.15s ease',
});

export const verticalSegment = style([
  guidelineSegment,
  {
    width: '1px',
    left: 0,
  },
]);

export const horizontalSegment = style([
  guidelineSegment,
  {
    height: '1px',
    top: 0,
  },
]);

export const guidelineLabel = style({
  position: 'absolute',
  pointerEvents: 'none',
  zIndex: 10000,
  userSelect: 'none',
  fontSize: '10px',
  fontWeight: 600,
  padding: '2px 6px',
  borderRadius: '3px',
  whiteSpace: 'nowrap',
  color: 'white',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)',
  transition: 'opacity 0.15s ease',
});
