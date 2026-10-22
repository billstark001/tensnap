import { style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  scrollbarWidth: 'thin',
  scrollbarColor: 'transparent transparent',
  selectors: {
    '&:hover, &:focus-within': { scrollbarColor: '#8889 transparent' },
    '&::-webkit-scrollbar': { width: 6, height: 6 },
    '&::-webkit-scrollbar-track, &::-webkit-scrollbar-corner': { background: 'transparent' },
    '&::-webkit-scrollbar-thumb': { background: 'transparent', borderRadius: 8 },
    '&:hover::-webkit-scrollbar-thumb, &:focus-within::-webkit-scrollbar-thumb': {
      background: '#8889',
    },
  },
  '@media': {
    '(pointer: coarse), (forced-colors: active)': { scrollbarColor: 'auto' },
  },
});
