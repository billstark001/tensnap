import { ButtonView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";
import clsx from 'clsx';
import { Play, Pause } from 'lucide-react';
import { useScenarioStore } from '@/store/scenario/store';
import { useProjectStore } from '@/store/project';
import { SNAPSHOT_PLAYBACK_ACTIONS } from '@tensnap/core/snapshot';
import { useEffect } from 'react';
import { isDirectModelAction } from '@/utils/direct-model-action';

export type ButtonViewProps = {
  view: ButtonView;
};

const stopReasonGlyph = {
  condition: '✓',
  'condition-error': '!',
  'max-steps': '✓',
  'wall-time': '⌛',
  'action-timeout': '!',
  'action-error': '!',
  'render-error': '!',
  simulator: '■',
  paused: 'Ⅱ',
  stopped: '■',
  disconnected: '×',
} as const;

export const ButtonViewComponent = ({ view }: ButtonViewProps) => {

  const { onButtonAction, isRunning } = useViewContext();
  const session = useScenarioStore((state) => state.session);
  const actions = useScenarioStore((state) => state.actions);
  const actionRevision = useScenarioStore((state) => state.actionRevision);
  const source = useProjectStore((state) => state.activeProject?.source);
  const runRevision = useScenarioStore((state) => state.runRevision);
  const isSnapshotSource = source?.kind === 'snapshot';
  void actionRevision;
  const action = actions?.get(view.data.id);
  const isDisabled = view.disabled
    || (isSnapshotSource
      ? !SNAPSHOT_PLAYBACK_ACTIONS.includes(view.data.id as typeof SNAPSHOT_PLAYBACK_ACTIONS[number])
      : !isDirectModelAction(action));
  const isContinuous = (view as ButtonView).data.continuous ?? false;
  const running = isContinuous && isRunning(view.data.id);
  const status = (() => {
    void runRevision;
    return session?.run.status;
  })();
  const isRunForContinuousButton = isContinuous && status?.spec.actionId === view.data.id;
  const conditionSummary = isRunForContinuousButton && status?.conditionValue !== undefined
    ? typeof status.conditionValue === 'string'
      ? status.conditionValue
      : JSON.stringify(status.conditionValue)
    : undefined;
  const visibleStopReason = status?.pauseRequested
    ? 'paused'
    : status?.stopReason ?? 'stopped';
  const runTitle = isRunForContinuousButton
    ? status.state === 'running' && !status.pauseRequested
      ? `${status.completedSteps}/${status.spec.mode === 'manual' ? '∞' : status.spec.maxSteps}${status.inFlight ? ' · waiting' : ''}${conditionSummary === undefined ? '' : ` · ${conditionSummary}`}`
      : `${status.completedSteps} · ${visibleStopReason}${conditionSummary === undefined ? '' : ` · ${conditionSummary}`}`
    : undefined;
  const runIndicator = isRunForContinuousButton
    ? status.state === 'running' && !status.pauseRequested
      ? `${status.completedSteps}/${status.spec.mode === 'manual' ? '∞' : status.spec.maxSteps}`
      : `${status.completedSteps} · ${stopReasonGlyph[visibleStopReason]}`
    : undefined;

  useEffect(() => {
    if (!isContinuous && status?.state === 'running' && status.spec.actionId === view.data.id) {
      session?.run.pause();
    }
  }, [isContinuous, session, status?.state, status?.spec.actionId, view.data.id]);

  return (
    <button
      type="button"
      className={clsx(
        styles.buttonView,
        isDisabled && styles.buttonViewDisabled,
        running && styles.buttonViewRunning,
      )}
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) return;
        if (!isContinuous) {
          onButtonAction(view.data.id, false);
          return;
        }
        onButtonAction(view.data.id, true);
      }}
      title={runTitle}
    >
      {isContinuous && (running ? <Pause size={14} /> : <Play size={14} />)}
      <span className={styles.buttonLabel}>{(view as ButtonView).data.text}</span>
      {runIndicator && <small className={styles.buttonRunIndicator}>{runIndicator}</small>}
    </button>
  );
};
