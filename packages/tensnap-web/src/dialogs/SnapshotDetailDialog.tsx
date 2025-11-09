import React, { useMemo } from 'react';
import * as Dialog from '@/components/ui/Dialog';
import { DialogOpenProps } from '@/utils/react';
import { Trans } from '@lingui/react/macro';
import { Environment, Snapshot } from '@/types/model';
import * as styles from './SnapshotDetailDialog.css';
import clsx from 'clsx';
import { GridEnvironmentView } from '../components/scenario/GridEnvironmentView';
import { InstantiatedGraphEnvironment, InstantiatedGridEnvironment, InstantiatedUniformEnvironment, instantiateEnvironment } from '@/store/scenario/environment';
import { GraphEnvironmentView } from '../components/scenario/GraphEnvironmentView';
import { UniformEnvironmentView } from '../components/scenario/UniformEnvironmentView';


const EnvironmentRenderer = (props: {
  environment: Environment;
}) => {
  const { environment: _environment } = props;

  const environment = useMemo(() => {
    try {
      const e = instantiateEnvironment(_environment);
      return e;
    } catch (error) {
      console.error('Failed to instantiate environment:', error);
      return null;
    }
  }, [_environment]);

  if (!environment || !environment.type) {
    return <div>Failed to load environment: {_environment.id}</div>;
  }

  if (environment.type === 'grid') {
    return <GridEnvironmentView environment={environment as InstantiatedGridEnvironment} />;
  }
  if (environment.type === 'graph') {
    return <GraphEnvironmentView environment={environment as InstantiatedGraphEnvironment} />;
  }
  if (environment.type === 'uniform') {
    return <UniformEnvironmentView environment={environment as InstantiatedUniformEnvironment} />;
  }

  return <div>Unsupported environment type: {environment.type}</div>;
};


export interface SnapshotDetailDialogProps extends DialogOpenProps {
  snapshot: Snapshot | null;
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
            <span className={styles.detailValue}>{snapshot.id}</span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Trans>Timestamp:</Trans>
            </span>
            <span className={styles.detailValue}>{formatDate(snapshot.timestamp)}</span>
          </div>

          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Trans>Time Step:</Trans>
            </span>
            <span className={styles.detailValue}>{snapshot.timeStep}</span>
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
                    {param.type === 'action' ? '-' : String(param.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
        <Dialog.Separator vertical />

        <div className={clsx(styles.detailSection, 'env')}>
          <div className={styles.environmentList}>
            {snapshot.environments.map((env) => (
              <div key={env.id} className={styles.environmentItem}>
                <div className={styles.environmentHeader}>
                  <span className={styles.environmentType}>{env.type}</span>
                  <span className={styles.environmentLabel}>{env.label || env.id}</span>
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
