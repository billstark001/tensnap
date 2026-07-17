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
import { useState } from 'react';
import { ContinuousRunDialog } from '@/dialogs/ContinuousRunDialog';
import { useProjectStore } from '@/store/project';
import { useToast } from '@/store/toast';
import { isDirectModelAction } from '@/utils/direct-model-action';
import { resolveToolbarActionIds } from './toolbar-action-model';
import { isActionVisiblyRunning } from '../../hooks/useButtonControls';

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
    isSnapshotSource,
    isSnapshotPlaying,
  } = useButtonControls();
  const { _ } = useLingui();
  const actions = useScenarioStore((state) => state.actions);
  const connected = useScenarioStore((state) => state.connected);
  const actionRevision = useScenarioStore((state) => state.actionRevision);
  const history = useScenarioUndoRedoStore();
  const stopRecording = useScenarioStore((state) => state.stopRecording);
  const profiles = useSettingsStore((state) => state.continuousRunProfiles);
  const setProfile = useSettingsStore((state) => state.setContinuousRunProfile);
  const [conditionalOpen, setConditionalOpen] = useState(false);
  void actionRevision;
  const liveToolbarActions = resolveToolbarActionIds(actions);
  const runActionId = isSnapshotSource ? 'start' : liveToolbarActions.runActionId;
  const stepActionId = isSnapshotSource ? 'step' : liveToolbarActions.stepActionId;
  const resetActionId = isSnapshotSource ? 'reset' : liveToolbarActions.resetActionId;
  const primaryActionIds = new Set([runActionId, stepActionId, resetActionId].filter(Boolean));
  const overflowActions = isSnapshotSource
    ? []
    : [...(actions?.values() ?? [])].filter((action) => isDirectModelAction(action) && !primaryActionIds.has(action.id));
  // A local run remains technically "running" until its dispatched tick has
  // completed, but it is no longer actionable as a running control once pause
  // has been requested. Keep this in lockstep with view buttons so the second
  // click cannot be swallowed as another pause request.
  const running = isSnapshotSource
    ? isSnapshotPlaying
    : isActionVisiblyRunning(runStatus, runActionId ?? '');
  const waiting = Boolean(running && runStatus?.inFlight);
  const runDisabled = (!isSnapshotSource && !connected) || !runActionId || Boolean(runStatus?.inFlight && !running);
  const diagnostic = (available: boolean, role: string, fallback: string) => (
    available ? fallback : `No ${role} action is available.`
  );

  return (
    <>
      <ToolGroupContainer>
      <ToolButton
        icon={running ? <Pause size={16} /> : <Play size={16} />}
        tooltip={diagnostic(Boolean(runActionId), 'run', running
          ? (waiting ? 'Pause after current tick' : 'Pause')
          : runStatus?.inFlight ? 'Waiting for current tick' : 'Run')}
        disabled={runDisabled}
        isActive={running}
        onClick={() => runActionId && (running ? pauseRun() : startManualRun(runActionId))}
      />
      <ToolButton
        icon={<Timer size={16} />}
        tooltip={diagnostic(Boolean(runActionId), 'run', _(msg`Conditional Run…`))}
        disabled={runDisabled}
        onClick={() => setConditionalOpen(true)}
      />
      <ToolButton
        icon={<SkipForward size={16} />}
        tooltip={diagnostic(Boolean(stepActionId), 'step', _(msg`Step`))}
        disabled={(!isSnapshotSource && !connected) || !stepActionId}
        onClick={() => stepActionId && requestStep(stepActionId)}
      />
      <ToolButton
        icon={<TimerReset size={16} />}
        tooltip={diagnostic(Boolean(resetActionId), 'reset', _(msg`Reset`))}
        disabled={(!isSnapshotSource && !connected) || !resetActionId}
        onClick={() => {
          if (!resetActionId) return;
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
            disabled={(!isSnapshotSource && !connected) || overflowActions.length === 0}
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
      {runActionId && !isSnapshotSource && (
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
  const captureSnapshot = useScenarioStore((store) => store.captureSnapshot);
  const dump = useScenarioStore((store) => store.dump);
  const updateMainViewLayout = useScenarioStore((store) => store.updateMainViewLayout);

  const transportStore = useTransportStore();
  const isSnapshotSource = useProjectStore((store) => store.activeProject?.source.kind === 'snapshot');
  const { _ } = useLingui();
  const toast = useToast();

  const handleTakeSnapshot = () => {
    void captureSnapshot?.().catch((error) => {
      toast.error(_(msg`Unable to capture snapshot`), error instanceof Error ? error.message : String(error));
    });
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
        disabled={isSnapshotSource}
      />
      <ToolButton
        icon={<RefreshCcw size={16} />}
        tooltip={_(msg`Synchronize State`)}
        onClick={() => dump ? transportStore?.requestStateSync(createStateSyncRequestFromStore(dump())) : undefined}
        disabled={isSnapshotSource}
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
