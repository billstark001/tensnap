import { ButtonView } from "@/types/ui";
import * as styles from './styles.css';
import { useViewContext } from "./useViewContext";
import clsx from 'clsx';
import { Play, Pause } from 'lucide-react';
import { useScenarioStore } from '@/store/scenario/store';
import { MAX_INT32_RUN_STEPS } from '@tensnap/core/runtime';
import { useEffect } from 'react';

export type ButtonViewProps = {
  view: ButtonView;
};

const stopReasonGlyph = {
  condition: '✓',
  'condition-error': '!',
  'max-steps': '✓',
  'wall-time': '⌛',
  'action-timeout': '!',
  'render-error': '!',
  simulator: '■',
  stopped: '■',
  disconnected: '×',
} as const;

export const ButtonViewComponent = ({ view }: ButtonViewProps) => {

  const { onButtonAction, isRunning } = useViewContext();
  const session = useScenarioStore((state) => state.session);
  const revision = useScenarioStore((state) => state._revision);
  const isDisabled = view.disabled;
  const isContinuous = (view as ButtonView).data.continuous ?? false;
  const running = isContinuous && isRunning(view.data.id);
  const status = (() => {
    void revision;
    return session?.run.status;
  })();
  const isRunForContinuousButton = isContinuous && status?.spec.actionId === view.data.id;
  const conditionSummary = isRunForContinuousButton && status?.conditionValue !== undefined
    ? typeof status.conditionValue === 'string'
      ? status.conditionValue
      : JSON.stringify(status.conditionValue)
    : undefined;
  const runTitle = isRunForContinuousButton
    ? status.state === 'running'
      ? `${status.completedSteps}/${status.spec.maxSteps === MAX_INT32_RUN_STEPS ? '∞' : status.spec.maxSteps}${conditionSummary === undefined ? '' : ` · ${conditionSummary}`}`
      : `${status.completedSteps} · ${status.stopReason ?? 'stopped'}${conditionSummary === undefined ? '' : ` · ${conditionSummary}`}`
    : undefined;
  const runIndicator = isRunForContinuousButton
    ? status.state === 'running'
      ? `${status.completedSteps}/${status.spec.maxSteps === MAX_INT32_RUN_STEPS ? '∞' : status.spec.maxSteps}`
      : `${status.completedSteps} · ${stopReasonGlyph[status.stopReason ?? 'stopped']}`
    : undefined;

  useEffect(() => {
    if (!isContinuous && status?.state === 'running' && status.spec.actionId === view.data.id) {
      session?.run.stop();
    }
  }, [isContinuous, session, status?.state, status?.spec.actionId, view.data.id]);

  return (
    <div
      className={clsx(
        styles.buttonView,
        isDisabled && styles.buttonViewDisabled,
        running && styles.buttonViewRunning,
      )}
      onClick={isDisabled ? undefined : () => {
        if (!isContinuous) {
          onButtonAction(view.data.id, false);
          return;
        }
        onButtonAction(view.data.id, true, {
          maxSteps: MAX_INT32_RUN_STEPS,
          record: false,
        });
      }}
      title={runTitle}
    >
      {isContinuous && (running ? <Pause size={14} /> : <Play size={14} />)}
      <span className={styles.buttonLabel}>{(view as ButtonView).data.text}</span>
      {runIndicator && <small className={styles.buttonRunIndicator}>{runIndicator}</small>}
    </div>
  );
};
