import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as styles from '../../styles/toolbar.css';

export interface ToolBarProps {
  className?: string;
}

export const ToolBar: React.FC<ToolBarProps> = ({ className }) => {
  return (
    <Tooltip.Provider>
      <div className={`${styles.toolGroup} ${className || ''}`}>
        {/* 文件操作工具组 */}
        <div className={styles.toolGroup}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                📄
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                New File
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                📁
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Open File
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                💾
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Save
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>

        <div className={styles.separator} />

        {/* 编辑工具组 */}
        <div className={styles.toolGroup}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                ↶
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Undo
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                ↷
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Redo
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>

        <div className={styles.separator} />

        {/* 模拟控制工具组（参考NetLogo） */}
        <div className={styles.toolGroup}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButtonVariants.active}>
                ▶️
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Run/Setup
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                ⏸️
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Pause
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                ⏹️
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Stop
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                ⏭️
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Step
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>

        <div className={styles.separator} />

        {/* 视图工具组 */}
        <div className={styles.toolGroup}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                🔍+
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Zoom In
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                🔍-
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Zoom Out
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                🎯
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Reset View
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>

        <div className={styles.separator} />

        {/* 工具模式切换 */}
        <div className={styles.toolGroup}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButtonVariants.active}>
                👆
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Select Mode
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                ✏️
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Edit Mode
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>

          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button className={styles.toolButton}>
                🔧
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className={styles.tooltipContent}>
                Debug Mode
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      </div>
    </Tooltip.Provider>
  );
};
