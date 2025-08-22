import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  FileText,
  FolderOpen,
  Save,
  Undo,
  Redo,
  Play,
  Square,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Target,
  MousePointer,
  Edit,
  Wrench,
  TimerReset
} from 'lucide-react';
import * as styles from '../../styles/toolbar.css';
import { useButtonControls } from '../useButtonControls';
import { useScenarioUndoRedoStore } from '@/store/undo-redo';

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

const ToolButton: React.FC<ToolButtonProps> = ({ 
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

export const ToolBar: React.FC<ToolBarProps> = ({ className }) => {

  const { handleButtonAction } = useButtonControls();
  const undoRedoStore = useScenarioUndoRedoStore();

  return (
    <Tooltip.Provider>
      <div className={`${styles.toolGroup} ${className || ''}`}>
        {/* 文件操作工具组 */}
        <div className={styles.toolGroup}>
          <ToolButton
            icon={<FileText size={16} />}
            tooltip="New File"
          />
          <ToolButton
            icon={<FolderOpen size={16} />}
            tooltip="Open File"
          />
          <ToolButton
            icon={<Save size={16} />}
            tooltip="Save"
          />
        </div>

        <div className={styles.separator} />

        {/* 编辑工具组 */}
        <div className={styles.toolGroup}>
          <ToolButton
            icon={<Undo size={16} />}
            tooltip="Undo"
            disabled={!undoRedoStore?.canUndo()}
            onClick={() => undoRedoStore?.undo()}
          />
          <ToolButton
            icon={<Redo size={16} />}
            tooltip="Redo"
            disabled={!undoRedoStore?.canRedo()}
            onClick={() => undoRedoStore?.redo()}
          />
        </div>

        <div className={styles.separator} />

        {/* 模拟控制工具组（参考NetLogo） */}
        <div className={styles.toolGroup}>
          <ToolButton
            icon={<Play size={16} />}
            tooltip="Start/Stop"
            isActive={true}
            onClick={() => handleButtonAction('start_stop')}
          />
          <ToolButton
            icon={<Square size={16} />}
            tooltip="Stop"
            onClick={() => handleButtonAction('stop')}
          />
          <ToolButton
            icon={<SkipForward size={16} />}
            tooltip="Step"
            onClick={() => handleButtonAction('step')}
          />
          <ToolButton
            icon={<TimerReset size={16} />}
            tooltip="Reset"
            onClick={() => handleButtonAction('reset')}
          />
        </div>

        <div className={styles.separator} />

        {/* 视图工具组 */}
        <div className={styles.toolGroup}>
          <ToolButton
            icon={<ZoomIn size={16} />}
            tooltip="Zoom In"
          />
          <ToolButton
            icon={<ZoomOut size={16} />}
            tooltip="Zoom Out"
          />
          <ToolButton
            icon={<Target size={16} />}
            tooltip="Reset View"
          />
        </div>

        <div className={styles.separator} />

        {/* 工具模式切换 */}
        <div className={styles.toolGroup}>
          <ToolButton
            icon={<MousePointer size={16} />}
            tooltip="Select Mode"
            isActive={true}
          />
          <ToolButton
            icon={<Edit size={16} />}
            tooltip="Edit Mode"
          />
          <ToolButton
            icon={<Wrench size={16} />}
            tooltip="Debug Mode"
          />
        </div>
      </div>
    </Tooltip.Provider>
  );
};