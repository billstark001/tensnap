import { useCallback } from 'react';
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
  Beaker,
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
import { createStateSyncRequestFromStore, useProjectStore } from '@/store/project';
import { useFakeModelPicker } from 'tensnap-web-utils';
import { useSettingsStore } from '@/store/settings';
import { SettingsDialog } from '@/dialogs/SettingsDialog';
import { AboutDialog } from '@/dialogs/AboutDialog';
import { useScenarioStore } from '@/store/scenario/store';
import { useWebSocketStore } from '@/store/websocket';

const ToolGroupContainer = ({ children }: { children: React.ReactNode }) => {
  return <div className={styles.toolGroup}>
    {children}
  </div>
};

const SHOW_LOAD_FAKE_MODEL_BUTTON = true;

export function FileOperationTools() {
  const { canSaveFile, onNewFile, onFileOpen, onFileSave } = useFileOperations();

  const { pickModel } = useFakeModelPicker();

  const createNewProject = useProjectStore((store) => store.new);

  const onLoadFakeModel = useCallback(async () => {
    const result = await pickModel();
    if (!result.cancelled && result.model) {
      createNewProject(result.model.url);
    }
  }, [pickModel, createNewProject]);

  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<FileText size={16} />}
        tooltip="New File"
        onClick={onNewFile}
      />
      {SHOW_LOAD_FAKE_MODEL_BUTTON && <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            onClick={onLoadFakeModel}
            className={styles.toolButton}
            aria-label="Load Fake Model"
          >
            <Beaker size={16} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltipContent}>
            Load Fake Model
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>}
      <ToolButton
        icon={<FolderOpen size={16} />}
        tooltip="Open File"
        onClick={onFileOpen}
      />
      <ToolButton
        icon={<Save size={16} />}
        tooltip="Save"
        onClick={onFileSave}
        disabled={!canSaveFile}
      />
    </ToolGroupContainer>
  )
}

export function UndoRedoTools() {
  const undoRedoStore = useScenarioUndoRedoStore();
  return (
    <ToolGroupContainer>
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
    </ToolGroupContainer>
  );
}

export function SimulationControlTools() {

  const { handleButtonAction } = useButtonControls();

  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<Play size={16} />}
        tooltip="Start/Stop"
        isActive={true}
        onClick={() => handleButtonAction('start_stop')}
      />
      <ToolButton
        icon={<Play size={16} />}
        tooltip="Start"
        onClick={() => handleButtonAction('start')}
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
    </ToolGroupContainer>
  )
}

export function ViewTools() {
  const scenarioStore = useScenarioStore();
  const websocketStore = useWebSocketStore();

  const handleTakeSnapshot = () => {
    scenarioStore?.addSnapshot({
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      timeStep: scenarioStore.currentTime,
    });
  };

  const { isAdjusting, setIsAdjusting } = useSettingsStore();

  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<MousePointer size={16} />}
        tooltip="Adjust Mode"
        isActive={isAdjusting}
        onClick={() => setIsAdjusting(!isAdjusting)}
      />
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
        tooltip="Take Snapshot"
        onClick={handleTakeSnapshot}
      />
      <ToolButton
        icon={<RefreshCcw size={16} />}
        tooltip="Synchronize State"
        onClick={() => scenarioStore ? websocketStore?.sendMessage({
          type: 'state_sync',
          payload: createStateSyncRequestFromStore(scenarioStore.dump()),
        }) : undefined}
      />
      <ToolButton
        icon={<LayoutTemplate size={16} />}
        tooltip="Update View Layout"
        onClick={() => scenarioStore?.updateMainViewLayout()}
      />
    </ToolGroupContainer>
  )
}

export function SettingTools() {
  const {
    settingsDialogOpen, setSettingsDialogOpen,
    aboutDialogOpen, setAboutDialogOpen,
    theme, toggleTheme,
  } = useSettingsStore();
  return (
    <ToolGroupContainer>

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            onClick={toggleTheme}
            className={styles.toolButton}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className={styles.tooltipContent}>
            Toggle Theme
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <ToolButton
        icon={<Edit size={16} />}
        tooltip="About"
        onClick={() => setAboutDialogOpen(true)}
      />
      <ToolButton
        icon={<Wrench size={16} />}
        tooltip="Settings"
        onClick={() => setSettingsDialogOpen(true)}
      />

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />
      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
    </ToolGroupContainer>
  );
}
