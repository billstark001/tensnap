
import * as RadixSelect from '@radix-ui/react-select';
import * as styles from './Select.css';
import { Check, ChevronDownIcon } from 'lucide-react';
import clsx from 'clsx';
import { forwardRef } from 'react';


export interface SelectProps extends RadixSelect.SelectProps {
  triggerClassName?: string;
  contentClassName?: string;
  triggerProps?: RadixSelect.SelectTriggerProps;
  contentProps?: RadixSelect.SelectContentProps;
}

export const Root = (props: SelectProps) => {
  const { triggerProps, contentProps, triggerClassName, contentClassName, children, ...rest } = props;
  return (
    <RadixSelect.Root {...rest}>
      <RadixSelect.Trigger className={clsx(styles.selectTrigger, triggerClassName)} {...triggerProps}>
        <RadixSelect.Value />
        <RadixSelect.Icon>
          <ChevronDownIcon size={16} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className={clsx(styles.selectContent, contentClassName)} position='popper'>
          {children}
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
};

export const Item = forwardRef<HTMLDivElement, RadixSelect.SelectItemProps & {
  indicator?: boolean;
  indicatorClassName?: string;
}>((props, ref) => {
  const { className, children, indicator, indicatorClassName, ...rest } = props;
  return (
    <RadixSelect.Item ref={ref} className={clsx(styles.selectItem, className)} {...rest}>
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      {indicator && (
        <RadixSelect.ItemIndicator className={clsx(styles.selectItemIndicator, indicatorClassName)}>
          <Check size={16} />
        </RadixSelect.ItemIndicator>
      )}
    </RadixSelect.Item>
  );
});
Item.displayName = 'SelectItem';

export const Viewport = RadixSelect.Viewport;
