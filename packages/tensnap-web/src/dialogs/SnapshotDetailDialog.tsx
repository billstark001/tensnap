import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/macro';
import { useLingui } from '@lingui/react';
import type { AssetStore, Scenario } from '@tensnap/core';
import type { ScenarioEnvironmentState } from '@tensnap/core/scenario';
import { SnapshotPlayer, type Snapshot } from '@tensnap/core/snapshot';
import { Pause, Play, SkipBack } from 'lucide-react';
import { getSnapshotIdentity } from '@/types/model';
import * as styles from './SnapshotDetailDialog.css';
import { Environment2DView } from '../components/scenario/Environment2DView';
import { UniformEnvironmentView } from '../components/scenario/UniformEnvironmentView';
import { ChartView } from '../components/scenario/ChartView';
import { getEnvironmentDisplayType } from '../components/scenario/environment-adapter';
import { ViewErrorBoundary } from '../components/view/ViewErrorBoundary';
import { formatTimestamp } from '@/utils/date';
import { useSettingsStore } from '@/store/settings';

const OfflineEnvironment = (props: {
  environment: ScenarioEnvironmentState;
  assets: AssetStore;
  scenario: Scenario;
  updateTrigger: number;
}) => {
  const { environment, assets, scenario, updateTrigger } = props;
  const displayType = getEnvironmentDisplayType(environment);
  if (displayType === '2d') {
    return <ViewErrorBoundary kind="environment" identifier={environment.id} resetKey={environment.id}><Environment2DView environment={environment} assets={assets} scenario={scenario} updateTrigger={updateTrigger} /></ViewErrorBoundary>;
  }
  if (displayType === 'uniform') {
    return <ViewErrorBoundary kind="environment" identifier={environment.id} resetKey={environment.id}><UniformEnvironmentView environment={environment} assets={assets} scenario={scenario} updateTrigger={updateTrigger} /></ViewErrorBoundary>;
  }
  return <div>Unsupported environment type: {environment.type}</div>;
};

export interface SnapshotDetailDialogProps extends DialogOpenProps {
  snapshot: Snapshot | null;
  onDelete: () => void;
  onRename: (label: string) => void;
  onOpenOffline: () => void;
}

/** Offline replay UI. It never writes a replayed state into a live renderer. */
export const SnapshotDetailDialog: React.FC<SnapshotDetailDialogProps> = ({
  open,
  onOpenChange,
  snapshot,
  onDelete,
  onRename,
  onOpenOffline,
}) => {
  const { _ } = useLingui();
  const firstFrame = snapshot?.initial.frame ?? 0;
  const lastFrame = snapshot?.frames[snapshot.frames.length - 1]?.index ?? firstFrame;
  const player = useMemo(() => snapshot ? new SnapshotPlayer(snapshot) : null, [snapshot]);
  const [frame, setFrame] = useState(firstFrame);
  const [playing, setPlaying] = useState(false);
  const [label, setLabel] = useState(snapshot?.metadata.label ?? '');
  const playbackFps = useSettingsStore((state) => state.snapshotPlaybackFps);
  const isStatic = !snapshot || snapshot.frames.length === 0;

  useEffect(() => {
    if (!playing || !snapshot || !player || isStatic) return;
    const handle = window.setInterval(() => {
      setFrame((current) => {
        const next = snapshot.frames.find((candidate) => candidate.index > current)?.index;
        if (next === undefined) {
          setPlaying(false);
          return current;
        }
        player.seek(next);
        return next;
      });
    }, 1_000 / playbackFps);
    return () => window.clearInterval(handle);
  }, [isStatic, playbackFps, player, playing, snapshot]);

  if (!snapshot || !player) return null;

  const identity = getSnapshotIdentity(snapshot);
  const currentFrame = snapshot.frames.find((candidate) => candidate.index === frame);
  const replay = player.scenario;
  const time = replay.metadata.time ?? '-';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="xl">
      <Dialog.CloseButton />
      <Dialog.Title><Trans>Snapshot replay</Trans></Dialog.Title>
      <Dialog.Description><Trans>Inspect this recording offline. Opening it creates a disconnected copy.</Trans></Dialog.Description>
      <Dialog.Body className={styles.detailContainer}>
        <div className={styles.replaySidebar}>
          <div className={styles.detailRow}>
            <label className={styles.detailLabel} htmlFor="snapshot-name"><Trans>Snapshot name</Trans></label>
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
          <div className={styles.detailRow}><span className={styles.detailLabel}><Trans>ID:</Trans></span><span className={styles.detailValue}>{identity.id}</span></div>
          <div className={styles.detailRow}><span className={styles.detailLabel}><Trans>Recorded:</Trans></span><span className={styles.detailValue}>{formatTimestamp(identity.timestamp)}</span></div>
          <div className={styles.detailRow}><span className={styles.detailLabel}><Trans>Frame:</Trans></span><span className={styles.detailValue}>{frame}/{lastFrame}</span></div>
          <div className={styles.detailRow}><span className={styles.detailLabel}><Trans>Simulation time:</Trans></span><span className={styles.detailValue}>{String(time)}</span></div>
          <div className={styles.detailRow}><span className={styles.detailLabel}><Trans>Frame updates:</Trans></span><span className={styles.detailValue}>{currentFrame?.messages.length ?? 0}</span></div>
          <div className={styles.detailRow}><span className={styles.detailLabel}><Trans>Action:</Trans></span><span className={styles.detailValue}>{currentFrame?.action?.id ?? '-'}</span></div>
          {!isStatic && <div className={styles.timelineControls}>
            <button type="button" className={styles.timelineButton} onClick={() => { player.seek(firstFrame); setFrame(firstFrame); }} title={_(msg`First frame`)} aria-label={_(msg`First frame`)}><SkipBack size={15} /></button>
            <button type="button" className={styles.timelineButton} onClick={() => setPlaying((value) => !value)} title={playing ? _(msg`Pause`) : _(msg`Play`)} aria-label={playing ? _(msg`Pause`) : _(msg`Play`)}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <input
              className={styles.timelineRange}
              type="range"
              min={firstFrame}
              max={lastFrame}
              value={frame}
              onChange={(event) => {
                setPlaying(false);
                const next = Number(event.target.value);
                player.seek(next);
                setFrame(player.frame);
              }}
            />
          </div>}
          {snapshot.truncated && <p className={styles.truncatedNotice}><Trans>Older frames were removed to stay within the recording budget.</Trans></p>}
          <Dialog.Separator />
          <h4 className={styles.sectionTitle}><Trans>Parameters</Trans></h4>
          <div className={styles.parameterList}>
            {[...replay.parameters.values()].map((parameter) => <div key={parameter.id} className={styles.parameterItem}><span className={styles.parameterLabel}>{parameter.label}</span><span className={styles.parameterValue}>{String(parameter.value ?? '-')}</span></div>)}
          </div>
        </div>
        <Dialog.Separator vertical />
        <div className={styles.replayContent}>
          <div className={styles.environmentList}>
            {[...replay.environments.values()].map((environment) => (
              <div key={environment.id} className={styles.environmentItem}>
                <div className={styles.environmentHeader}><span className={styles.environmentType}>{environment.type}</span><span className={styles.environmentLabel}>{environment.id}</span></div>
                <div className={styles.environmentDisplay}><OfflineEnvironment environment={environment} assets={replay.assets} scenario={replay} updateTrigger={frame} /></div>
              </div>
            ))}
          </div>
          {replay.charts.getGroupList().length > 0 && <div className={styles.chartList}>
            {replay.charts.getGroupList().map((group) => <div key={group.id} className={styles.chartItem}><h4 className={styles.sectionTitle}>{group.label || group.id}</h4><ChartView chartGroup={group} updateInterval={0} updateTrigger={frame} /></div>)}
          </div>}
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Button variant="danger" onClick={onDelete}><Trans>Delete recording</Trans></Dialog.Button>
        <Dialog.Button variant="primary" onClick={onOpenOffline}><Trans>Open as offline copy</Trans></Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
