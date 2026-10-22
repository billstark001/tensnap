import * as Primitive from '@radix-ui/react-switch';
import { useId, type ReactNode } from 'react';
import clsx from 'clsx';
import * as styles from './Switch.css';

export interface SwitchProps extends Omit<Primitive.SwitchProps, 'children'> {
  label: ReactNode;
  labelPosition?: 'before' | 'after';
  labelClassName?: string;
}

export function Switch({
  label,
  labelPosition = 'after',
  labelClassName,
  className,
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  return (
    <label className={styles.field} htmlFor={id}>
      {labelPosition === 'before' && <span className={labelClassName}>{label}</span>}
      <Primitive.Root {...props} id={id} className={clsx(styles.root, className)}>
        <Primitive.Thumb className={styles.thumb} />
      </Primitive.Root>
      {labelPosition === 'after' && <span className={labelClassName}>{label}</span>}
    </label>
  );
}
