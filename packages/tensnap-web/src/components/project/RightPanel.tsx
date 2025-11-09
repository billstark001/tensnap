import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './RightPanel.css';
import { Trans } from '@lingui/react/macro';
import { Camera, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Snapshot } from '@/types/model';
import { SnapshotDetailDialog } from '../../dialogs/SnapshotDetailDialog';

export const RightPanel = () => {
  const scenarioStore = useScenarioStore();
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!scenarioStore) {
    return (
      <div className={styles.rightPanel}>
        <div className={styles.panelHeader}>
          <h3><Trans>Scenario Properties</Trans></h3>
        </div>
        <div className={styles.panelContent}>
          <p><Trans>No scenario data loaded.</Trans></p>
        </div>
      </div>
    );
  }

  const snapshots = scenarioStore.snapshots;
  const currentTime = scenarioStore.currentTime;

  const handleTakeSnapshot = () => {
    scenarioStore.addSnapshot({
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      timeStep: currentTime,
    });
  };

  const handleClearSnapshots = () => {
    scenarioStore.clearSnapshots();
  };

  const handleSnapshotClick = (snapshot: Snapshot) => {
    setSelectedSnapshot(snapshot);
    setDialogOpen(true);
  };

  const handleDeleteSnapshot = () => {
    if (selectedSnapshot) {
      scenarioStore.removeSnapshot(selectedSnapshot.id);
      setDialogOpen(false);
      setSelectedSnapshot(null);
    }
  };

  const handleRestoreSnapshot = () => {
    // TODO: Implement restore functionality
    console.log('Restore snapshot:', selectedSnapshot);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const truncateParameters = (snapshot: Snapshot, maxLength: number = 50) => {
    const paramStr = snapshot.parameters
      .filter(p => p.type !== 'action')
      .map(p => `${p.label}: ${p.value}`)
      .join(', ');
    
    if (paramStr.length <= maxLength) {
      return paramStr;
    }
    return paramStr.substring(0, maxLength) + '...';
  };

  return (
    <div className={styles.rightPanel}>
      <div className={styles.panelHeader}>
        <h3><Trans>Snapshots</Trans></h3>
        <div className={styles.headerButtons}>
          <button
            className={styles.headerButton}
            onClick={handleTakeSnapshot}
            title="Take Snapshot"
          >
            <Camera size={16} />
            <span><Trans>Take Snapshot</Trans></span>
          </button>
          <button
            className={styles.headerButton}
            onClick={handleClearSnapshots}
            title="Clear All Snapshots"
            disabled={snapshots.length === 0}
          >
            <Trash2 size={16} />
            <span><Trans>Clear All</Trans></span>
          </button>
        </div>
      </div>
      <div className={styles.panelContent}>
        {snapshots.length === 0 ? (
          <p className={styles.emptyMessage}>
            <Trans>No snapshots yet. Click "Take Snapshot" to create one.</Trans>
          </p>
        ) : (
          <div className={styles.snapshotList}>
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className={styles.snapshotItem}
                onClick={() => handleSnapshotClick(snapshot)}
              >
                <div className={styles.snapshotHeader}>
                  <span className={styles.snapshotId}>{snapshot.id}</span>
                  <span className={styles.snapshotTime}>
                    {formatDate(snapshot.timestamp)}
                  </span>
                </div>
                <div className={styles.snapshotInfo}>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Time Step:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>{snapshot.timeStep}</span>
                  </div>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Environments:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>
                      {snapshot.environments.length}
                    </span>
                  </div>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Parameters:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>
                      {truncateParameters(snapshot)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SnapshotDetailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        snapshot={selectedSnapshot}
        onDelete={handleDeleteSnapshot}
        onRestore={handleRestoreSnapshot}
      />
    </div>
  );
};
