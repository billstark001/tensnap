import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './RightPanel.css';
import { Trans } from '@lingui/react/macro';
import { Camera, Circle, Copy, Image, Square, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Snapshot } from '@tensnap/core/snapshot';
import type { AssetMeta } from '@tensnap/protocol';
import { getSnapshotIdentity } from '@/types/model';
import { SnapshotDetailDialog } from '../../dialogs/SnapshotDetailDialog';
import { useToast } from '@/store/toast';
import { EmptyState } from '@tensnap/web-common/components/ui/EmptyState';
import { formatTimestamp } from '@/utils/date';
import { useProjectStore } from '@/store/project';

export const RightPanel = () => {
  const scenario = useScenarioStore((store) => store.scenario);
  const session = useScenarioStore((store) => store.session);
  useScenarioStore((store) => store.assetRevision);

  const snapshots = useScenarioStore((store) => store.snapshots);
  const addSnapshot = useScenarioStore((store) => store.addSnapshot);
  const captureSnapshot = useScenarioStore((store) => store.captureSnapshot);
  const clearSnapshots = useScenarioStore((store) => store.clearSnapshots);
  const removeSnapshot = useScenarioStore((store) => store.removeSnapshot);
  const startRecording = useScenarioStore((store) => store.startRecording);
  const stopRecording = useScenarioStore((store) => store.stopRecording);
  const renameSnapshot = useScenarioStore((store) => store.renameSnapshot);
  const isRecording = useScenarioStore((store) => store.isRecording);
  const openOfflineSnapshot = useProjectStore((store) => store.openOfflineSnapshot);
  const activeSnapshotSourceId = useProjectStore((store) => {
    const source = store.activeProject?.source;
    return source?.kind === 'snapshot' ? source.snapshot_id : null;
  });
  const isSnapshotSource = activeSnapshotSourceId !== null;

  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'snapshots' | 'assets'>('snapshots');
  const [assetFilter, setAssetFilter] = useState('');
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  const toast = useToast();

  const assets = [...(scenario?.assets.listMeta() ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const filteredAssets = assets.filter((asset) => {
    if (!assetFilter.trim()) return true;
    const q = assetFilter.toLowerCase();
    return asset.id.toLowerCase().includes(q)
      || (asset.label?.toLowerCase().includes(q) ?? false)
      || asset.mime.toLowerCase().includes(q);
  });

  const handleTakeSnapshot = async () => {
    if (isCapturingSnapshot) return;
    setIsCapturingSnapshot(true);
    try {
      if (captureSnapshot) await captureSnapshot();
      else addSnapshot?.();
    } catch (error) {
      toast.error('Unable to capture snapshot', error instanceof Error ? error.message : String(error));
    } finally {
      setIsCapturingSnapshot(false);
    }
  };

  const handleClearSnapshots = () => {
    clearSnapshots?.();
  };

  const handleSnapshotClick = (snapshot: Snapshot) => {
    setSelectedSnapshot(snapshot);
    setDialogOpen(true);
  };

  const handleDeleteSnapshot = () => {
    if (selectedSnapshot) {
      if (selectedSnapshot.metadata.id === activeSnapshotSourceId) {
        toast.warning('Recording is in use', 'This recording is the active project source and cannot be deleted.');
        return;
      }
      removeSnapshot?.(getSnapshotIdentity(selectedSnapshot).id);
      setDialogOpen(false);
      setSelectedSnapshot(null);
    }
  };

  const handleOpenOfflineSnapshot = (frame?: number) => {
    if (!selectedSnapshot) return;
    openOfflineSnapshot(selectedSnapshot, undefined, frame);
    setDialogOpen(false);
    setSelectedSnapshot(null);
  };

  const handleRenameSnapshot = (label: string) => {
    if (!selectedSnapshot) return;
    renameSnapshot?.(selectedSnapshot.metadata.id, label);
  };

  const truncateParameters = (snapshot: Snapshot, maxLength: number = 50) => {
    const paramStr = snapshot.initial.scenario.parameters
      .map(p => `${p.label}: ${p.value}`)
      .join(', ');

    if (paramStr.length <= maxLength) {
      return paramStr;
    }
    return paramStr.substring(0, maxLength) + '...';
  };

  const formatSize = (size: number): string => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderAssetItem = (asset: AssetMeta) => {
    const resolved = scenario?.assets.get(asset.id);
    const url = scenario?.assets.getUrl(asset.id);
    const isImage = asset.mime.startsWith('image/');

    return (
      <div key={asset.id} className={styles.snapshotItem}>
        <div className={styles.snapshotHeader}>
          <span className={styles.snapshotId}>{asset.label || asset.id}</span>
          <div className={styles.assetHeaderActions}>
            <span className={styles.snapshotTime}>{resolved ? <Trans>Ready</Trans> : <Trans>Pending</Trans>}</span>
            <button
              type="button"
              className={styles.assetCopyButton}
              title="Copy Asset ID"
              aria-label="Copy Asset ID"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(asset.id);
                  toast.success('Copied', `Asset ID copied: ${asset.id}`);
                } catch {
                  toast.error('Copy failed', `Unable to copy asset ID: ${asset.id}`);
                }
              }}
            >
              <Copy size={14} />
            </button>
          </div>
        </div>
        {isImage && url && (
          <div className={styles.assetPreviewWrapper}>
            <img src={url} alt={asset.label || asset.id} className={styles.assetPreviewImage} />
          </div>
        )}
        <div className={styles.snapshotInfo}>
          <div className={styles.snapshotInfoRow}>
            <span className={styles.snapshotLabel}><Trans>ID:</Trans></span>
            <span className={styles.snapshotValue}>{asset.id}</span>
          </div>
          <div className={styles.snapshotInfoRow}>
            <span className={styles.snapshotLabel}><Trans>MIME:</Trans></span>
            <span className={styles.snapshotValue}>{asset.mime}</span>
          </div>
          <div className={styles.snapshotInfoRow}>
            <span className={styles.snapshotLabel}><Trans>Size:</Trans></span>
            <span className={styles.snapshotValue}>{formatSize(asset.size)}</span>
          </div>
          <div className={styles.snapshotInfoRow}>
            <span className={styles.snapshotLabel}><Trans>Hash:</Trans></span>
            <span className={styles.snapshotValue}>{asset.hash.slice(0, 12)}...</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.rightPanel}>
      <div className={styles.panelHeader}>
        <h3><Trans>Inspector</Trans></h3>
        <div className={styles.tabRow}>
          <button
            className={activeTab === 'snapshots' ? styles.tabButtonActive : styles.tabButton}
            onClick={() => setActiveTab('snapshots')}
            type="button"
          >
            <Trans>Snapshots</Trans>
          </button>
          <button
            className={activeTab === 'assets' ? styles.tabButtonActive : styles.tabButton}
            onClick={() => setActiveTab('assets')}
            type="button"
          >
            <Trans>Assets</Trans>
          </button>
        </div>

        {activeTab === 'snapshots' && (
        <div className={styles.headerButtons}>
          <button
            className={styles.headerButton}
            onClick={() => isRecording ? stopRecording?.() : startRecording?.()}
            title={isRecording ? 'Stop Recording' : 'Start Recording'}
            aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
            disabled={isSnapshotSource || isCapturingSnapshot}
          >
            {isRecording ? <Square size={16} /> : <Circle size={16} />}
            <span>{isRecording ? <Trans>Stop recording</Trans> : <Trans>Start recording</Trans>}</span>
          </button>
          <button
            className={styles.headerButton}
            onClick={handleTakeSnapshot}
            title="Take Snapshot"
            aria-label="Take Snapshot"
            disabled={isSnapshotSource || isCapturingSnapshot}
          >
            <Camera size={16} />
            <span>{isCapturingSnapshot ? <Trans>Capturing…</Trans> : <Trans>Take Snapshot</Trans>}</span>
          </button>
          <button
            className={styles.headerButton}
            onClick={handleClearSnapshots}
            title="Clear All Snapshots"
            aria-label="Clear All Snapshots"
            disabled={isSnapshotSource || !snapshots?.length}
          >
            <Trash2 size={16} />
            <span><Trans>Clear All</Trans></span>
          </button>
        </div>
        )}
      </div>
      <div className={styles.panelContent}>
        {activeTab === 'snapshots' && (!snapshots?.length ? (
          <EmptyState
            compact
            icon={<Camera size={48} />}
            title={<Trans>No snapshots yet.</Trans>}
            description={<Trans>Click "Take Snapshot" to create one.</Trans>}
          />
        ) : (
          <div className={styles.snapshotList}>
            {snapshots.map((snapshot) => {
              const identity = getSnapshotIdentity(snapshot);
              const displayName = snapshot.metadata.label?.trim() || identity.id;
              return (
              <div
                key={identity.id}
                className={styles.snapshotItem}
                onClick={() => handleSnapshotClick(snapshot)}
              >
                <div className={styles.snapshotHeader}>
                  <span className={styles.snapshotId}>{displayName}</span>
                  <span className={styles.snapshotTime}>
                    {formatTimestamp(identity.timestamp)}
                  </span>
                </div>
                <div className={styles.snapshotInfo}>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Time Step:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>{String(snapshot.initial.scenario.metadata.time ?? '-')}</span>
                  </div>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Environments:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>
                      {snapshot.initial.scenario.environments.length}
                    </span>
                  </div>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Frames:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>{snapshot.frames.length}</span>
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
              );
            })}
          </div>
        ))}

        {activeTab === 'assets' && (!assets.length ? (
          <EmptyState
            compact
            icon={<Image size={48} />}
            title={<Trans>No assets registered.</Trans>}
            description={<Trans>Assets sent by adapters will appear here.</Trans>}
          />
        ) : (
          <>
            <input
              className={styles.assetFilterInput}
              type="text"
              value={assetFilter}
              onChange={(e) => setAssetFilter(e.target.value)}
              placeholder="Filter by id/label/mime"
            />
            <div className={styles.snapshotList}>
              {filteredAssets.map((asset) => renderAssetItem(asset))}
            </div>
          </>
        ))}

      </div>

      <SnapshotDetailDialog
        key={selectedSnapshot?.metadata.id ?? 'no-snapshot'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        snapshot={selectedSnapshot}
        onDelete={handleDeleteSnapshot}
        deleteDisabled={selectedSnapshot?.metadata.id === activeSnapshotSourceId}
        onRename={handleRenameSnapshot}
        onOpenOffline={handleOpenOfflineSnapshot}
        session={session}
      />
    </div>
  );
};
