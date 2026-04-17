import { useScenarioStore } from '@/store/scenario/store';
import * as styles from './RightPanel.css';
import { Trans } from '@lingui/react/macro';
import { Camera, Copy, Image, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AssetMeta, ScenarioSnapshot } from '@tensnap/core';
import { getSnapshotIdentity } from '@/types/model';
import { SnapshotDetailDialog } from '../../dialogs/SnapshotDetailDialog';
import { useToast } from '@/store/toast';
import { EmptyState } from '../ui/EmptyState';

export const RightPanel = () => {
  const scenario = useScenarioStore((store) => store.scenario);
  useScenarioStore((store) => store._assetRevision);

  const snapshots = useScenarioStore((store) => store.snapshots);
  const addSnapshot = useScenarioStore((store) => store.addSnapshot);
  const clearSnapshots = useScenarioStore((store) => store.clearSnapshots);
  const removeSnapshot = useScenarioStore((store) => store.removeSnapshot);

  const [selectedSnapshot, setSelectedSnapshot] = useState<ScenarioSnapshot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'snapshots' | 'assets'>('snapshots');
  const [assetFilter, setAssetFilter] = useState('');
  const toast = useToast();

  const assets = [...(scenario?.assets.listMeta() ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const filteredAssets = assets.filter((asset) => {
    if (!assetFilter.trim()) return true;
    const q = assetFilter.toLowerCase();
    return asset.id.toLowerCase().includes(q)
      || (asset.label?.toLowerCase().includes(q) ?? false)
      || asset.mime.toLowerCase().includes(q);
  });

  const handleTakeSnapshot = () => {
    addSnapshot?.();
  };

  const handleClearSnapshots = () => {
    clearSnapshots?.();
  };

  const handleSnapshotClick = (snapshot: ScenarioSnapshot) => {
    setSelectedSnapshot(snapshot);
    setDialogOpen(true);
  };

  const handleDeleteSnapshot = () => {
    if (selectedSnapshot) {
      removeSnapshot?.(getSnapshotIdentity(selectedSnapshot).id);
      setDialogOpen(false);
      setSelectedSnapshot(null);
    }
  };

  const handleRestoreSnapshot = () => {
    // TODO: Implement restore functionality
    toast.info('Restore snapshot', `ID: ${selectedSnapshot ? getSnapshotIdentity(selectedSnapshot).id : ''}`);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const truncateParameters = (snapshot: ScenarioSnapshot, maxLength: number = 50) => {
    const paramStr = snapshot.parameters
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
            onClick={handleTakeSnapshot}
            title="Take Snapshot"
            aria-label="Take Snapshot"
          >
            <Camera size={16} />
            <span><Trans>Take Snapshot</Trans></span>
          </button>
          <button
            className={styles.headerButton}
            onClick={handleClearSnapshots}
            title="Clear All Snapshots"
            aria-label="Clear All Snapshots"
            disabled={!snapshots?.length}
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
              return (
              <div
                key={identity.id}
                className={styles.snapshotItem}
                onClick={() => handleSnapshotClick(snapshot)}
              >
                <div className={styles.snapshotHeader}>
                  <span className={styles.snapshotId}>{identity.id}</span>
                  <span className={styles.snapshotTime}>
                    {formatDate(identity.timestamp)}
                  </span>
                </div>
                <div className={styles.snapshotInfo}>
                  <div className={styles.snapshotInfoRow}>
                    <span className={styles.snapshotLabel}>
                      <Trans>Time Step:</Trans>
                    </span>
                    <span className={styles.snapshotValue}>{String(snapshot.metadata.time ?? '-')}</span>
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
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        snapshot={selectedSnapshot}
        onDelete={handleDeleteSnapshot}
        onRestore={handleRestoreSnapshot}
      />
    </div>
  );
};
