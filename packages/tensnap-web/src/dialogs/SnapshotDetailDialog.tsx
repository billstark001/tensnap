import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import { encodeRecordingFile } from '@tensnap/core/persistence';
import { frameFromRecording, snapshotFromFrame } from '@tensnap/core/snapshot';
import { useFileSystem } from '@/store/file-system/provider';
import { uint8ArrayToArrayBuffer } from '@tensnap/core/utils';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import ContextMenu from '@tensnap/web-common/components/ui/ContextMenu';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';
import { msg, t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { AssetStore, Scenario } from '@tensnap/core';
import type { RendererSession } from '@tensnap/core/runtime';
import type { ChartGroup } from '@tensnap/core/chart';
import { exportToCSV } from '@tensnap/core/chart/browser';
import type { ScenarioEnvironmentState } from '@tensnap/core/scenario';
import { SnapshotPlaybackSource, type Snapshot } from '@tensnap/core/snapshot';
import {
  ClipboardCopy,
  Pause,
  Play,
  Sheet,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
} from 'lucide-react';
import { getSnapshotIdentity } from '@/types/model';
import * as styles from './SnapshotDetailDialog.css';
import { Environment2DView } from '../components/scenario/Environment2DView';
import { UniformEnvironmentView } from '../components/scenario/UniformEnvironmentView';
import { ChartView } from '../components/scenario/ChartView';
import { ViewErrorBoundary } from '../components/view/ViewErrorBoundary';
import { ValueInspector } from '../components/value-inspector';
import { formatTimestamp } from '@/utils/date';
import { useSettingsStore } from '@/store/settings';
import { useToast } from '@/store/toast';
import { copyCanvas } from '@/utils/data';
import { SceneRestoreDialog } from './SceneRestoreDialog';

const OfflineEnvironment = (props: {
  environment: ScenarioEnvironmentState;
  assets: AssetStore;
  scenario: Scenario;
  updateTrigger: number;
}) => {
  const { environment, assets, scenario, updateTrigger } = props;
  const displayType = environment.type;
  if (displayType === '2d') {
    return (
      <ViewErrorBoundary kind="environment" identifier={environment.id} resetKey={environment.id}>
        <Environment2DView
          environment={environment}
          assets={assets}
          scenario={scenario}
          updateTrigger={updateTrigger}
        />
      </ViewErrorBoundary>
    );
  }
  if (displayType === 'uniform') {
    return (
      <ViewErrorBoundary kind="environment" identifier={environment.id} resetKey={environment.id}>
        <UniformEnvironmentView
          environment={environment}
          assets={assets}
          scenario={scenario}
          updateTrigger={updateTrigger}
        />
      </ViewErrorBoundary>
    );
  }
  return <div>Unsupported environment type: {environment.type}</div>;
};

/** Gives replay previews the same export/copy actions as their live-view counterparts. */
const SnapshotPreviewContextMenu: React.FC<{
  chartGroup?: ChartGroup;
  className: string;
  children: React.ReactNode;
}> = ({ chartGroup, className, children }) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const handleCopy = useCallback(async () => {
    const canvas = previewRef.current?.querySelector('canvas');
    if (!canvas) {
      toast.error(t`Canvas not found.`);
      return;
    }
    try {
      if (await copyCanvas(canvas)) toast.success(t`Canvas copied to clipboard!`);
      else toast.error(t`Failed to copy canvas to clipboard.`);
    } catch (error) {
      toast.error(t`Failed to copy canvas to clipboard.`, String(error));
    }
  }, [toast]);

  return (
    <ContextMenu.Root
      trigger={
        <div ref={previewRef} className={className}>
          {children}
        </div>
      }
    >
      <ContextMenu.Label>
        <Trans>Options</Trans>
      </ContextMenu.Label>
      {chartGroup && (
        <ContextMenu.Item onSelect={() => exportToCSV(chartGroup)}>
          <Sheet />
          <Trans>Save As CSV</Trans>
        </ContextMenu.Item>
      )}
      <ContextMenu.Item onSelect={handleCopy}>
        <ClipboardCopy />
        <Trans>Copy</Trans>
      </ContextMenu.Item>
    </ContextMenu.Root>
  );
};

export interface SnapshotDetailDialogProps extends DialogOpenProps {
  snapshot: Snapshot | null;
  onDelete: () => void;
  deleteDisabled?: boolean;
  onRename: (label: string) => void;
  onOpenOffline: (frame?: number) => void;
  session?: RendererSession | null;
}

/** Offline replay UI. It never writes a replayed state into a live renderer. */
const SnapshotDetailDialogContent: React.FC<SnapshotDetailDialogProps> = ({
  open,
  onOpenChange,
  snapshot,
  onDelete,
  deleteDisabled = false,
  onRename,
  onOpenOffline,
  session,
}) => {
  const { _ } = useLingui();
  const firstFrame = snapshot?.initial.frame ?? 0;
  const lastFrame = snapshot?.frames[snapshot.frames.length - 1]?.index ?? firstFrame;
  const player = useMemo(
    () => (snapshot ? new SnapshotPlaybackSource(snapshot) : null),
    [snapshot],
  );
  const retainedFrames = useMemo(
    () =>
      snapshot ? [snapshot.initial.frame, ...snapshot.frames.map((frame) => frame.index)] : [],
    [snapshot],
  );
  const [frame, setFrame] = useState(firstFrame);
  const [playing, setPlaying] = useState(false);
  const [label, setLabel] = useState(snapshot?.metadata.label ?? '');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const { saveFileAs, writeFile } = useFileSystem();
  const toast = useToast();
  const saveFormat = useSettingsStore((state) => state.saveFormat);
  const exportRecording = async (singleFrame: boolean) => {
    if (!snapshot) return;
    try {
      const target = singleFrame
        ? snapshotFromFrame(frameFromRecording(snapshot, frame))
        : snapshot;
      const bytes = encodeRecordingFile(target, { format: saveFormat });
      const file = await saveFileAs({
        title: singleFrame ? t`Export current frame` : t`Export full recording`,
        defaultPath: `${target.metadata.id}.tensnap-recording.${saveFormat}`,
        filters: [{ name: 'TenSnap recording', extensions: [saveFormat] }],
      });
      if (!file) return;
      await writeFile(file.path, uint8ArrayToArrayBuffer(bytes));
      toast.success(t`Recording exported`, file.path);
    } catch (error) {
      toast.error(t`Failed to export recording`, String(error));
    }
  };
  const playbackFps = useSettingsStore((state) => state.snapshotPlaybackFps);
  const isStatic = !snapshot || snapshot.frames.length === 0;

  useEffect(() => {
    if (!open || !playing || !snapshot || !player || isStatic) return;
    const handle = window.setInterval(() => {
      const next = player.stepFrame();
      if (next) setFrame(next.index);
      if (!next || next.index === lastFrame) setPlaying(false);
    }, 1_000 / playbackFps);
    return () => window.clearInterval(handle);
  }, [isStatic, playbackFps, player, playing, snapshot, open, lastFrame]);

  if (!snapshot || !player) return null;

  const seekFrame = (next: number) => {
    setPlaying(false);
    player.seek(next);
    setFrame(player.frame);
  };
  const stepFrame = (direction: -1 | 1) => {
    const position = retainedFrames.indexOf(player.frame);
    const next = retainedFrames[position + direction];
    if (next !== undefined) seekFrame(next);
  };
  const identity = getSnapshotIdentity(snapshot);
  const currentFrame = snapshot.frames.find((candidate) => candidate.index === frame);
  const replay = player.scenario;
  const time = replay.metadata.time ?? '-';
  const monitors = [...replay.monitors.all.values()];

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange} size="xl">
        <Dialog.CloseButton />
        <Dialog.Title>
          <Trans>Snapshot replay</Trans>
        </Dialog.Title>
        <Dialog.Description>
          <Trans>Inspect this recording offline. Opening it creates a disconnected copy.</Trans>
        </Dialog.Description>
        <Dialog.Body className={styles.detailContainer}>
          <div className={styles.replaySidebar}>
            <div className={styles.detailRow}>
              <label className={styles.detailLabel} htmlFor="snapshot-name">
                <Trans>Snapshot name</Trans>
              </label>
              <input
                id="snapshot-name"
                className={styles.snapshotNameInput}
                value={label}
                placeholder={identity.id}
                onChange={(event) => {
                  const next = event.target.value;
                  setLabel(next);
                  onRename(next);
                }}
              />
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>
                <Trans>ID:</Trans>
              </span>
              <span className={styles.detailValue}>{identity.id}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>
                <Trans>Recorded:</Trans>
              </span>
              <span className={styles.detailValue}>{formatTimestamp(identity.timestamp)}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>
                <Trans>Frame:</Trans>
              </span>
              <span className={styles.detailValue}>
                {frame}/{lastFrame}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>
                <Trans>Simulation time:</Trans>
              </span>
              <span className={styles.detailValue}>{String(time)}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>
                <Trans>Frame updates:</Trans>
              </span>
              <span className={styles.detailValue}>{currentFrame?.messages.length ?? 0}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>
                <Trans>Action:</Trans>
              </span>
              <span className={styles.detailValue}>{currentFrame?.action?.id ?? '-'}</span>
            </div>
            {!isStatic && (
              <div className={styles.timelineControls}>
                <input
                  className={styles.timelineRange}
                  type="range"
                  aria-label={_(msg`Recording frame`)}
                  min={firstFrame}
                  max={lastFrame}
                  value={frame}
                  onChange={(event) => seekFrame(Number(event.target.value))}
                />
                <div
                  className={styles.timelineButtons}
                  role="group"
                  aria-label={_(msg`Playback controls`)}
                >
                  <button
                    type="button"
                    className={styles.timelineButton}
                    disabled={frame === firstFrame}
                    onClick={() => seekFrame(firstFrame)}
                    title={_(msg`First frame`)}
                    aria-label={_(msg`First frame`)}
                  >
                    <SkipBack size={15} />
                  </button>
                  <button
                    type="button"
                    className={styles.timelineButton}
                    disabled={frame === firstFrame}
                    onClick={() => stepFrame(-1)}
                    title={_(msg`Previous frame`)}
                    aria-label={_(msg`Previous frame`)}
                  >
                    <StepBack size={15} />
                  </button>
                  <button
                    type="button"
                    className={styles.timelineButton}
                    onClick={() => {
                      if (!playing && frame === lastFrame) seekFrame(firstFrame);
                      setPlaying((value) => !value);
                    }}
                    title={playing ? _(msg`Pause`) : _(msg`Play`)}
                    aria-label={playing ? _(msg`Pause`) : _(msg`Play`)}
                  >
                    {playing ? <Pause size={15} /> : <Play size={15} />}
                  </button>
                  <button
                    type="button"
                    className={styles.timelineButton}
                    disabled={frame === lastFrame}
                    onClick={() => stepFrame(1)}
                    title={_(msg`Next frame`)}
                    aria-label={_(msg`Next frame`)}
                  >
                    <StepForward size={15} />
                  </button>
                  <button
                    type="button"
                    className={styles.timelineButton}
                    disabled={frame === lastFrame}
                    onClick={() => seekFrame(lastFrame)}
                    title={_(msg`Last frame`)}
                    aria-label={_(msg`Last frame`)}
                  >
                    <SkipForward size={15} />
                  </button>
                </div>
              </div>
            )}
            {snapshot.truncated && (
              <p className={styles.truncatedNotice}>
                <Trans>Older frames were removed to stay within the recording budget.</Trans>
              </p>
            )}
            <Dialog.Separator />
            <h4 className={styles.sectionTitle}>
              <Trans>Parameters</Trans>
            </h4>
            <div className={styles.parameterList}>
              {[...replay.parameters.values()].map((parameter) => (
                <div key={parameter.id} className={styles.parameterItem}>
                  <span className={styles.parameterLabel}>{parameter.label}</span>
                  <span className={styles.parameterValue}>{String(parameter.value ?? '-')}</span>
                </div>
              ))}
            </div>
            <Dialog.Separator />
            <h4 className={styles.sectionTitle}>
              <Trans>Monitors</Trans>
            </h4>
            <div className={styles.monitorList}>
              {monitors.length === 0 ? (
                <p className={styles.emptyMonitorNotice}>
                  <Trans>No monitor data was recorded.</Trans>
                </p>
              ) : (
                monitors.map((monitor) => (
                  <section key={monitor.id} className={styles.monitorItem}>
                    <span className={styles.monitorLabel}>{monitor.label || monitor.id}</span>
                    <ValueInspector
                      value={monitor.value ?? null}
                      renderHint={monitor.render_hint ?? 'auto'}
                      compact
                    />
                  </section>
                ))
              )}
            </div>
          </div>
          <Dialog.Separator vertical />
          <div className={styles.replayContent}>
            <div className={styles.environmentList}>
              {[...replay.environments.values()].map((environment) => (
                <SnapshotPreviewContextMenu key={environment.id} className={styles.environmentItem}>
                  <div className={styles.environmentHeader}>
                    <span className={styles.environmentType}>{environment.type}</span>
                    <span className={styles.environmentLabel}>{environment.id}</span>
                  </div>
                  <div className={styles.environmentDisplay}>
                    <OfflineEnvironment
                      environment={environment}
                      assets={replay.assets}
                      scenario={replay}
                      updateTrigger={frame}
                    />
                  </div>
                </SnapshotPreviewContextMenu>
              ))}
            </div>
            {replay.charts.getGroupList().length > 0 && (
              <div className={styles.chartList}>
                {replay.charts.getGroupList().map((group) => (
                  <SnapshotPreviewContextMenu
                    key={group.id}
                    className={styles.chartItem}
                    chartGroup={group}
                  >
                    <h4 className={styles.sectionTitle}>{group.label || group.id}</h4>
                    <ChartView chartGroup={group} updateInterval={0} updateTrigger={frame} />
                  </SnapshotPreviewContextMenu>
                ))}
              </div>
            )}
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Button onClick={() => void exportRecording(false)}>
            <Trans>Export full recording</Trans>
          </Dialog.Button>
          <Dialog.Button onClick={() => void exportRecording(true)}>
            <Trans>Export current frame</Trans>
          </Dialog.Button>
          <Dialog.Button variant="danger" onClick={onDelete} disabled={deleteDisabled}>
            <Trans>Delete recording</Trans>
          </Dialog.Button>
          <Dialog.Button
            onClick={() => setRestoreOpen(true)}
            disabled={!session?.isConnected || !session.simulatorInfo}
          >
            <Trans>Restore to live simulator</Trans>
          </Dialog.Button>
          <Dialog.Button variant="primary" onClick={() => onOpenOffline(frame)}>
            <Trans>Open as offline copy</Trans>
          </Dialog.Button>
        </Dialog.Footer>
      </Dialog.Root>
      <SceneRestoreDialog
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        snapshot={snapshot}
        session={session}
      />
    </>
  );
};

export const SnapshotDetailDialog = defineDialog(
  'SnapshotDetailDialog',
  SnapshotDetailDialogContent,
);
