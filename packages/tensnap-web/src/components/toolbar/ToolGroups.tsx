import * as Tooltip from '@radix-ui/react-tooltip';
import {
  FileText,
  FolderOpen,
  Save,
  Undo,
  Redo,
  Play,
  Pause,
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
  LayoutTemplate,
  Timer,
  MoreHorizontal,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { resolveActionBindings } from '@tensnap/core/runtime';
import { useState } from 'react';
import { ContinuousRunDialog } from '@/dialogs/ContinuousRunDialog';

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
  const undoCommand = undoRedoStore?.past[undoRedoStore.past.length - 1];
  return (
    <ToolGroupContainer>
      <ToolButton
        icon={<Undo size={16} />}
        tooltip={undoCommand?.label ? `Undo ${undoCommand.label}` : _(msg`Undo`)}
        disabled={!undoRedoStore?.canUndo()}
        onClick={() => undoRedoStore?.undo()}
      />
      <ToolButton
        icon={<Redo size={16} />}
        tooltip={undoRedoStore?.future[0]?.label ? `Redo ${undoRedoStore.future[0].label}` : _(msg`Redo`)}
        disabled={!undoRedoStore?.canRedo()}
        onClick={() => undoRedoStore?.redo()}
      />
    </ToolGroupContainer>
  );
}

export function SimulationControlTools() {
  const {
    runStatus,
    startManualRun,
    startBoundedRun,
    pauseRun,
    requestStep,
    requestReset,
    requestModelAction,
  } = useButtonControls();
  const { _ } = useLingui();
  const actions = useScenarioStore((state) => state.actions);
  const connected = useScenarioStore((state) => state.connected);
  const revision = useScenarioStore((state) => state._revision);
  const history = useScenarioUndoRedoStore();
  const stopRecording = useScenarioStore((state) => state.stopRecording);
  const profiles = useSettingsStore((state) => state.continuousRunProfiles);
  const setProfile = useSettingsStore((state) => state.setContinuousRunProfile);
  const [conditionalOpen, setConditionalOpen] = useState(false);
  void revision;
  const resolution = resolveActionBindings(actions?.values() ?? []);
  const runActionId = resolution.bindings.run;
  const stepActionId = resolution.bindings.step;
  const resetActionId = resolution.bindings.reset;
  const primaryActionIds = new Set([runActionId, stepActionId, resetActionId].filter(Boolean));
  const overflowActions = [...(actions?.values() ?? [])].filter((action) => !primaryActionIds.has(action.id));
  const running = runStatus?.state === 'running';
  const waiting = running && runStatus.inFlight;
  const runDisabled = !connected || !runActionId || Boolean(resolution.errors.run) || Boolean(runStatus?.inFlight && !running);
  const diagnostic = (role: 'run' | 'step' | 'reset', fallback: string) => resolution.errors[role]
    ?? (!resolution.bindings[role] ? `No ${role} action is available.` : fallback);

  return (
    <>
      <ToolGroupContainer>
      <ToolButton
        icon={running ? <Pause size={16} /> : <Play size={16} />}
        tooltip={diagnostic('run', running
          ? (waiting ? 'Pause after current tick' : 'Pause')
          : runStatus?.inFlight ? 'Waiting for current tick' : 'Run')}
        disabled={runDisabled}
        isActive={running}
        onClick={() => runActionId && (running ? pauseRun() : startManualRun(runActionId))}
      />
      <ToolButton
        icon={<Timer size={16} />}
        tooltip={diagnostic('run', _(msg`Conditional Run…`))}
        disabled={runDisabled}
        onClick={() => setConditionalOpen(true)}
      />
      <ToolButton
        icon={<SkipForward size={16} />}
        tooltip={diagnostic('step', _(msg`Step`))}
        disabled={!connected || !stepActionId || Boolean(resolution.errors.step)}
        onClick={() => stepActionId && requestStep(stepActionId)}
      />
      <ToolButton
        icon={<TimerReset size={16} />}
        tooltip={diagnostic('reset', _(msg`Reset`))}
        disabled={!connected || !resetActionId || Boolean(resolution.errors.reset)}
        onClick={() => {
          if (!resetActionId) return;
          const confirmed = globalThis.confirm('Reset the model? Active recording will stop and renderer edit history will be cleared. Saved snapshots are kept.');
          if (!confirmed) return;
          stopRecording?.();
          history?.clear();
          requestReset(resetActionId);
        }}
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={styles.toolButton}
            aria-label={_(msg`More Actions`)}
            disabled={!connected || overflowActions.length === 0}
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.dropdownContent} sideOffset={5}>
            {overflowActions.map((action) => (
              <DropdownMenu.Item
                key={action.id}
                className={styles.dropdownItem}
                onSelect={() => requestModelAction(action.id)}
              >
                {`Model action: ${action.label}`}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      </ToolGroupContainer>
      {runActionId && (
        <ContinuousRunDialog
          key={`${runActionId}:${conditionalOpen}:${JSON.stringify(profiles[runActionId])}`}
          open={conditionalOpen}
          actionId={runActionId}
          profile={profiles[runActionId]}
          onOpenChange={setConditionalOpen}
          onRun={(profile) => {
            setProfile(runActionId, profile);
            startBoundedRun(runActionId, {
              maxSteps: profile.maxSteps,
              stopWhen: profile.stopWhen,
              maxWallTimeMs: profile.maxWallTimeMs,
              record: profile.record ? {} : false,
            });
          }}
        />
      )}
    </>
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
