import React, { useMemo } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';
import { Scenario, ScenarioEnvironmentSnapshot, ScenarioSnapshot } from '@tensnap/core';
import { getSnapshotIdentity } from '@/types/model';
import * as styles from './SnapshotDetailDialog.css';
import clsx from 'clsx';
import { Environment2DView } from '../components/scenario/Environment2DView';
import { UniformEnvironmentView } from '../components/scenario/UniformEnvironmentView';
import { getEnvironmentDisplayType } from '../components/scenario/environment-adapter';


const EnvironmentRenderer = (props: {
  environment: ScenarioEnvironmentSnapshot;
}) => {
  const { environment } = props;
  const liveEnvironment = useMemo(() => {
    const scenario = new Scenario();
    scenario.load({
      metadata: {},
      actions: [],
      parameters: [],
      environments: [environment],
      charts: [],
      logs: [],
    });
    return scenario.getEnvironment(environment.id);
  }, [environment]);
  const displayType = liveEnvironment ? getEnvironmentDisplayType(liveEnvironment) : null;

  if (!liveEnvironment) {
    return <div>Environment not found: {environment.id}</div>;
  }

  if (displayType === '2d') {
    return <Environment2DView environment={liveEnvironment} />;
  }
  if (displayType === 'uniform') {
    return <UniformEnvironmentView environment={liveEnvironment} />;
  }

  return <div>Unsupported environment type: {environment.type}</div>;
};


export interface SnapshotDetailDialogProps extends DialogOpenProps {
  snapshot: ScenarioSnapshot | null;
  onDelete: () => void;
  onRestore: () => void;
}

export const SnapshotDetailDialog: React.FC<SnapshotDetailDialogProps> = ({
  open,
  onOpenChange,
  snapshot,
  onDelete,
  onRestore,
}) => {
  if (!snapshot) {
    return null;
  }

  const snapshotIdentity = getSnapshotIdentity(snapshot);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="xl">
      <Dialog.CloseButton />
      <Dialog.Title>
        <Trans>Snapshot Details</Trans>
      </Dialog.Title>
      <Dialog.Description>
        <Trans>View and manage snapshot</Trans>
      </Dialog.Description>

      <Dialog.Body className={styles.detailContainer}>

        <div className={styles.detailSection}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Trans>ID:</Trans>
            </span>
            <span className={styles.detailValue}>{snapshotIdentity.id}</span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Trans>Timestamp:</Trans>
            </span>
            <span className={styles.detailValue}>{formatDate(snapshotIdentity.timestamp)}</span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Trans>Time Step:</Trans>
            </span>
            <span className={styles.detailValue}>{String(snapshot.metadata.time ?? '-')}</span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Trans>Environments:</Trans>
            </span>
            <span className={styles.detailValue}>{snapshot.environments.length}</span>
          </div>
          <Dialog.Separator />
          <div className={clsx(styles.detailSection, 'scroll')}>
            <h4 className={styles.sectionTitle}>
              <Trans>Parameters</Trans>
            </h4>
            <div className={styles.parameterList}>
              {snapshot.parameters.map((param) => (
                <div key={param.id} className={styles.parameterItem}>
                  <span className={styles.parameterLabel}>{param.label}:</span>
                  <span className={styles.parameterValue}>
                    {String((param as { value?: any }).value ?? '-')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {snapshot.charts && snapshot.charts.length > 0 && (
            <>
              <Dialog.Separator />
              <div className={clsx(styles.detailSection, 'scroll')}>
                <h4 className={styles.sectionTitle}>
                  <Trans>Chart Data</Trans>
                </h4>
                <div className={styles.parameterList}>
                  {snapshot.charts.map((group) => (
                    <div key={group.id} className={styles.parameterItem}>
                      <span className={styles.parameterLabel}>{group.label || group.id}:</span>
                      <span className={styles.parameterValue}>
                        {group.data.length} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

        </div>
        <Dialog.Separator vertical />

        <div className={clsx(styles.detailSection, 'env')}>
          <div className={styles.environmentList}>
            {snapshot.environments.map((env) => (
              <div key={env.id} className={styles.environmentItem}>
                <div className={styles.environmentHeader}>
                  <span className={styles.environmentType}>{env.type}</span>
                  <span className={styles.environmentLabel}>{env.id}</span>
                </div>
                <div className={styles.environmentDisplay}>
                  <EnvironmentRenderer environment={env} />
                </div>
              </div>
            ))}
          </div>
        </div>

      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Button variant="danger" onClick={onDelete}>
          <Trans>Delete Snapshot</Trans>
        </Dialog.Button>
        <Dialog.Button variant="primary" onClick={onRestore}>
          <Trans>Restore Snapshot</Trans>
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
