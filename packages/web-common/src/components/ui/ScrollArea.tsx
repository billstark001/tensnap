import { forwardRef, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import * as styles from './ScrollArea.css';

/** One native scroll viewport; refs, styles and events all address the same element. */
export const ScrollArea = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div {...props} ref={ref} className={clsx(styles.root, className)} />
  ),
);
