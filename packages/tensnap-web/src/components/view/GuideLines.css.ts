import { style } from '@vanilla-extract/css';

export const guidelinesContainer = style({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 9999,
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
  backgroundColor: '#007AFF',
  opacity: 0.8,
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
