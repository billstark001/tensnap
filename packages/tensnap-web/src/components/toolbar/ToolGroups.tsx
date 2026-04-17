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
  TimerReset,
  Moon,
  Sun,
  RefreshCcw,
  LayoutTemplate
} from 'lucide-react';
import * as styles from '@/styles/toolbar.css';
import { useButtonControls } from '../../hooks/useButtonControls';
import { useScenarioUndoRedoStore } from '@/store/undo-redo';
import { useFileOperations } from './useFileOperations';

import { ToolButton } from './ToolButton';
import { createStateSyncRequestFromStore } from '@/store/project';
import { useSettingsStore } from '@/store/settings';
import { AboutDialog } from '@/dialogs/AboutDialog';
import { useScenarioStore } from '@/store/scenario/store';
import { useTransportStore } from '@/store/transport';
import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';

const ToolGroupContainer = ({ children }: { children: React.ReactNode }) => {
  return <div className={styles.toolGroup}>
    {children}
  </div>
};


export function FileOperationTools() {
  const { canSaveFile, onNewFile, onFileOpen, onFileSave } = useFileOperations();
  const { _ } = useLingui();

  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<FileText size={16} />}
        tooltip={_(msg`New File`)}
        onClick={onNewFile}
      />

      <ToolButton
        icon={<FolderOpen size={16} />}
        tooltip={_(msg`Open File`)}
        onClick={onFileOpen}
      />
      <ToolButton
        icon={<Save size={16} />}
        tooltip={_(msg`Save`)}
        onClick={onFileSave}
        disabled={!canSaveFile}
      />
    </ToolGroupContainer>
  )
}

export function UndoRedoTools() {
  const undoRedoStore = useScenarioUndoRedoStore();
  const { _ } = useLingui();
  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<Undo size={16} />}
        tooltip={_(msg`Undo`)}
        disabled={!undoRedoStore?.canUndo()}
        onClick={() => undoRedoStore?.undo()}
      />
      <ToolButton
        icon={<Redo size={16} />}
        tooltip={_(msg`Redo`)}
        disabled={!undoRedoStore?.canRedo()}
        onClick={() => undoRedoStore?.redo()}
      />
    </ToolGroupContainer>
  );
}

export function SimulationControlTools() {

  const { handleButtonAction } = useButtonControls();
  const { _ } = useLingui();

  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<Play size={16} />}
        tooltip={_(msg`Start/Stop`)}
        isActive={true}
        onClick={() => handleButtonAction('start_stop')}
      />
      <ToolButton
        icon={<Play size={16} />}
        tooltip={_(msg`Start`)}
        onClick={() => handleButtonAction('start')}
      />
      <ToolButton
        icon={<Square size={16} />}
        tooltip={_(msg`Stop`)}
        onClick={() => handleButtonAction('stop')}
      />
      <ToolButton
        icon={<SkipForward size={16} />}
        tooltip={_(msg`Step`)}
        onClick={() => handleButtonAction('step')}
      />
      <ToolButton
        icon={<TimerReset size={16} />}
        tooltip={_(msg`Reset`)}
        onClick={() => handleButtonAction('reset')}
      />
    </ToolGroupContainer>
  )
}

export function ViewTools() {
  const addSnapshot = useScenarioStore((store) => store.addSnapshot);
  const dump = useScenarioStore((store) => store.dump);
  const updateMainViewLayout = useScenarioStore((store) => store.updateMainViewLayout);

  const transportStore = useTransportStore();
  const { _ } = useLingui();

  const handleTakeSnapshot = () => {
    addSnapshot?.();
  };

  const { isAdjusting, setIsAdjusting } = useSettingsStore();

  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<MousePointer size={16} />}
        tooltip={_(msg`Adjust Mode`)}
        isActive={isAdjusting}
        onClick={() => setIsAdjusting(!isAdjusting)}
      />
      <ToolButton
        icon={<ZoomIn size={16} />}
        tooltip={_(msg`Zoom In`)}
      />
      <ToolButton
        icon={<ZoomOut size={16} />}
        tooltip={_(msg`Zoom Out`)}
      />
      <ToolButton
        icon={<Target size={16} />}
        tooltip={_(msg`Take Snapshot`)}
        onClick={handleTakeSnapshot}
      />
      <ToolButton
        icon={<RefreshCcw size={16} />}
        tooltip={_(msg`Synchronize State`)}
        onClick={() => dump ? transportStore?.sendMessage({
          type: 'state_sync',
          payload: createStateSyncRequestFromStore(dump()),
        }) : undefined}
      />
      <ToolButton
        icon={<LayoutTemplate size={16} />}
        tooltip={_(msg`Update View Layout`)}
        onClick={() => updateMainViewLayout?.()}
      />
    </ToolGroupContainer>
  )
}

export function SettingTools() {
  const {
    setSettingsDialogOpen,
    aboutDialogOpen, setAboutDialogOpen,
    theme, toggleTheme,
  } = useSettingsStore();
  const { _ } = useLingui();
  return (
    <ToolGroupContainer>

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            onClick={toggleTheme}
            className={styles.toolButton}
            aria-label={_(msg`Toggle theme`)}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltipContent}>
            {_(msg`Toggle Theme`)}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <ToolButton
        icon={<Edit size={16} />}
        tooltip={_(msg`About`)}
        onClick={() => setAboutDialogOpen(true)}
      />
      <ToolButton
        icon={<Wrench size={16} />}
        tooltip={_(msg`Settings`)}
        onClick={() => setSettingsDialogOpen(true)}
      />

      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
    </ToolGroupContainer>
  );
}
