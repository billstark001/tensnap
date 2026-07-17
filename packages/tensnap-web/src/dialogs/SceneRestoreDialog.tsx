import type { RendererSession, RestoreChartPolicy } from '@tensnap/core/runtime';
import {
  materializeSnapshot,
  projectedRestoreChangesTopology,
  projectSnapshotForRestore,
  type Snapshot,
} from '@tensnap/core/snapshot';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/store/toast';
import * as styles from './SceneRestoreDialog.css';
import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';

export interface SceneRestoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: Snapshot | null;
  session: RendererSession | null | undefined;
}

type SceneRestoreDialogContentProps = Omit<SceneRestoreDialogProps, 'open'> & {
  firstFrame: number;
  lastFrame: number;
  onPendingChange: (pending: boolean) => void;
};

type RestoreMode = 'checkpoint' | 'projected';

function snapshotIdentityMatchesLive(
  snapshot: Snapshot,
  live: NonNullable<RendererSession['simulatorInfo']>,
): boolean {
  const checkpoint = snapshot.metadata.checkpoint;
  const identities = [
    snapshot.metadata.model_identity,
    checkpoint && { model_id: checkpoint.model_id, state_schema_version: checkpoint.state_schema_version },
  ].filter((identity): identity is { model_id: string; state_schema_version?: string } => identity !== undefined);
  return identities.length > 0 && identities.every((identity) => (
    identity.model_id === live.model.id
      && (identity.state_schema_version === undefined
        || identity.state_schema_version === live.model.state_schema_version)
  ));
}

/** Capability-gated, snapshot-to-live restore. Snapshot charts stay local. */
function SceneRestoreDialogContent({
  onOpenChange,
  snapshot,
  session,
  firstFrame,
  lastFrame,
  onPendingChange,
}: SceneRestoreDialogContentProps) {
  const { _ } = useLingui();
  const toast = useToast();
  const [frame, setFrame] = useState(lastFrame);
  const [chartPolicy, setChartPolicy] = useState<RestoreChartPolicy>('replace');
  const [restoreMode, setRestoreMode] = useState<RestoreMode>(snapshot?.metadata.checkpoint && firstFrame === lastFrame ? 'checkpoint' : 'projected');
  const [requestId, setRequestId] = useState<string | null>(null);
  const operationAbortRef = useRef<AbortController | null>(null);
  const info = session?.simulatorInfo ?? null;
  const capabilities = Array.isArray(info?.capabilities) ? info.capabilities : [];
  const connected = session?.isConnected ?? false;
  const canProject = capabilities.includes('scene.restore.projected');
  const checkpoint = snapshot?.metadata.checkpoint;
  const identityMatches = Boolean(snapshot && info && snapshotIdentityMatchesLive(snapshot, info));
  const canCheckpoint = Boolean(
    checkpoint
      && frame === firstFrame
      && identityMatches
      && capabilities.includes('scene.restore.checkpoint'),
  );

  useEffect(() => {
    return () => {
      operationAbortRef.current?.abort();
      operationAbortRef.current = null;
    };
  }, []);

  const preview = useMemo(() => {
    if (!snapshot) return null;
    try {
      return projectSnapshotForRestore(materializeSnapshot(snapshot, frame));
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [frame, snapshot]);
  const requiresTopology = useMemo(() => {
    if (!session || !preview || preview instanceof Error) return false;
    return projectedRestoreChangesTopology(session.scenario, preview.envs);
  }, [preview, session]);
  const canRestoreTopology = !requiresTopology || capabilities.includes('scene.restore.topology');

  const restore = async () => {
    const canRestore = restoreMode === 'checkpoint'
      ? canCheckpoint
      : canProject && identityMatches && canRestoreTopology && !(preview instanceof Error);
    if (!session || !snapshot || !connected || !canRestore) return;
    const id = `restore-${crypto.randomUUID()}`;
    const controller = new AbortController();
    operationAbortRef.current = controller;
    setRequestId(id);
    onPendingChange(true);
    let restored = false;
    try {
      const identity = snapshot.metadata.model_identity ?? (checkpoint
        ? { model_id: checkpoint.model_id, state_schema_version: checkpoint.state_schema_version }
        : undefined);
      if (restoreMode === 'checkpoint') {
        if (!checkpoint) throw new Error('This snapshot does not contain an exact checkpoint.');
        const result = await session.restoreScene({
          request_id: id,
          ...(identity?.state_schema_version === undefined ? {} : { state_schema_version: identity.state_schema_version }),
          ...(info?.instance_id ? { expected_instance_id: info.instance_id } : {}),
          checkpoint: { encoding: checkpoint.encoding, data: checkpoint.data },
        }, { signal: controller.signal });
        if (result.status !== 'ok') {
          throw new Error(result.error?.message ?? _(t`Simulator returned ${result.status}.`));
        }
      } else {
        const state = materializeSnapshot(snapshot, frame);
        const projected = projectSnapshotForRestore(state);
        const result = await session.restoreScene({
          request_id: id,
          ...(identity?.state_schema_version === undefined ? {} : { state_schema_version: identity.state_schema_version }),
          ...(info?.instance_id ? { expected_instance_id: info.instance_id } : {}),
          time: projected.time,
          parameters: projected.parameters,
          envs: projected.envs,
        }, {
          chartPolicy,
          replacementCharts: chartPolicy === 'replace' ? state.charts : undefined,
          signal: controller.signal,
        });
        if (result.status !== 'ok') {
          throw new Error(result.error?.message ?? _(t`Simulator returned ${result.status}.`));
        }
      }
      toast.success(_(msg`Snapshot restored`));
      restored = true;
    } catch (error) {
      if (!controller.signal.aborted) {
        toast.error(_(msg`Snapshot restore failed`), error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operationAbortRef.current === controller) operationAbortRef.current = null;
      setRequestId(null);
      onPendingChange(false);
    }
    if (restored) onOpenChange(false);
  };

  const unavailableReason = !connected
    ? _(msg`Connect to a live simulator before restoring a snapshot.`)
    : !info
      ? _(msg`Waiting for simulator information before restoring a snapshot.`)
      : !identityMatches
        ? _(msg`This snapshot was created by a different model or state schema and cannot be restored to the connected simulator.`)
        : restoreMode === 'checkpoint'
          ? !checkpoint
            ? _(msg`This snapshot does not contain an exact checkpoint.`)
            : frame !== firstFrame
              ? _(msg`Exact checkpoints are available only at the recording's initial frame.`)
              : !canCheckpoint
                ? _(msg`The connected simulator does not declare scene.restore.checkpoint.`)
                : null
          : !canProject
            ? _(msg`The connected simulator does not declare scene.restore.projected.`)
            : !canRestoreTopology
              ? _(msg`This snapshot changes environment topology, but the simulator does not declare scene.restore.topology.`)
              : preview instanceof Error
                ? preview.message
                : null;

  return <>
    <Dialog.CloseButton disabled={Boolean(requestId)} />
    <Dialog.Title><Trans>Restore snapshot to simulator</Trans></Dialog.Title>
    <Dialog.Description><Trans>Restore an exact checkpoint or projected parameters, environments, and time. Chart history stays local.</Trans></Dialog.Description>
    <Dialog.Body className={styles.body}>
      {unavailableReason && <p className={styles.warning}>{unavailableReason}</p>}
      <label className={styles.field}>
        <span><Trans>Recording frame: {frame}</Trans></span>
        <input type="range" min={firstFrame} max={lastFrame} value={frame} disabled={!snapshot || Boolean(requestId)} onChange={(event) => {
          const nextFrame = Number(event.target.value);
          setFrame(nextFrame);
          if (nextFrame !== firstFrame) setRestoreMode('projected');
        }} />
      </label>
      {checkpoint && <label className={styles.field}>
        <span><Trans>Restore method</Trans></span>
        <select value={restoreMode} disabled={Boolean(requestId)} onChange={(event) => setRestoreMode(event.target.value as RestoreMode)}>
          <option value="checkpoint" disabled={frame !== firstFrame}><Trans>Exact checkpoint</Trans></option>
          <option value="projected"><Trans>Projected scene</Trans></option>
        </select>
      </label>}
      {restoreMode === 'projected' && <label className={styles.field}>
        <span><Trans>Chart policy</Trans></span>
        <select value={chartPolicy} disabled={Boolean(unavailableReason) || Boolean(requestId)} onChange={(event) => setChartPolicy(event.target.value as RestoreChartPolicy)}>
          <option value="replace"><Trans>Replace with snapshot charts</Trans></option>
          <option value="preserve"><Trans>Keep live charts</Trans></option>
          <option value="truncate" disabled={preview instanceof Error || preview?.time === undefined}><Trans>Truncate live charts at restore time</Trans></option>
        </select>
      </label>}
      {restoreMode === 'checkpoint' && checkpoint && <p className={styles.summary}><Trans>The simulator will restore the exact checkpoint captured for this snapshot.</Trans></p>}
      {restoreMode === 'projected' && !(preview instanceof Error) && preview && <p className={styles.summary}>{_(t`Will restore ${preview.parameters.length} parameters and ${preview.envs.length} environments${preview.time === undefined ? '' : ` at time ${preview.time}`}.`)}</p>}
    </Dialog.Body>
    <Dialog.Footer>
      <Dialog.Button onClick={() => onOpenChange(false)} disabled={Boolean(requestId)}><Trans>Cancel</Trans></Dialog.Button>
      <Dialog.Button variant="primary" onClick={restore} disabled={Boolean(unavailableReason) || Boolean(requestId)}>{requestId ? <Trans>Restoring…</Trans> : <Trans>Restore snapshot</Trans>}</Dialog.Button>
    </Dialog.Footer>
  </>;
}

export function SceneRestoreDialog({ open, onOpenChange, snapshot, session }: SceneRestoreDialogProps) {
  const firstFrame = snapshot?.initial.frame ?? 0;
  const lastFrame = snapshot?.frames[snapshot.frames.length - 1]?.index ?? firstFrame;
  const [isRestoring, setIsRestoring] = useState(false);
  const isRestoringRef = useRef(false);
  const handlePendingChange = (pending: boolean) => {
    isRestoringRef.current = pending;
    setIsRestoring(pending);
  };
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isRestoringRef.current) return;
    onOpenChange(nextOpen);
  };
  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} size="md" closeOnInteractOutside={!isRestoring}>
      {open && <SceneRestoreDialogContent
        key={`${snapshot?.metadata.id ?? 'no-snapshot'}:${lastFrame}`}
        onOpenChange={handleOpenChange}
        snapshot={snapshot}
        session={session}
        firstFrame={firstFrame}
        lastFrame={lastFrame}
        onPendingChange={handlePendingChange}
      />}
    </Dialog.Root>
  );
}
