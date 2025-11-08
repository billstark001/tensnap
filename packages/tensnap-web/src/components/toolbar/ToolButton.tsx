import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as styles from '@/styles/toolbar.css';

export interface ToolBarProps {
  className?: string;
}

// 辅助组件：工具按钮
interface ToolButtonProps {
  icon: React.ReactNode;
  tooltip: string;
  isActive?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export const ToolButton: React.FC<ToolButtonProps> = ({
  icon,
  tooltip,
  isActive = false,
  disabled,
  onClick
}) => {
  const buttonClass = isActive
    ? styles.toolButtonVariants?.active || styles.toolButton
    : styles.toolButton;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className={buttonClass} onClick={onClick} disabled={disabled}>
          {icon}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={styles.tooltipContent}>
          {tooltip}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
};
