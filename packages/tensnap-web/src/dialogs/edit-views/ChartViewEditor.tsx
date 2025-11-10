import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@/components/ui/Form';
import { AnchoredView } from '@/types/ui';
import { BaseViewFields, BaseViewEditorProps } from './BaseViewEditor';
import { ChartGroup, ChartMetadata } from '@/types/model';
import * as styles from './EditViews.css';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import { generateUniqueId } from '@/utils/common';

interface ChartViewEditorProps extends BaseViewEditorProps {
  view: AnchoredView;
  objectData: ChartGroup | null;
  onObjectChange: (field: string, value: any) => void;
}

export const ChartViewEditor: React.FC<ChartViewEditorProps> = ({ view, objectData: chartGroup, onChange, onObjectChange }) => {
  const [editingMetadataId, setEditingMetadataId] = useState<string | null>(null);
  const [newMetadataForm, setNewMetadataForm] = useState<{ id: string; label: string; color: string } | null>(null);

  const metadataList = chartGroup ? Object.values(chartGroup.metadataDict) : [];

  const handleAddMetadata = () => {
    if (!newMetadataForm) {
      setNewMetadataForm({
        id: `series-${generateUniqueId()}`,
        label: 'New Series',
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
      });
    } else {
      if (chartGroup && newMetadataForm.id && newMetadataForm.label) {
        const newMetadataDict = {
          ...chartGroup.metadataDict,
          [newMetadataForm.id]: {
            id: newMetadataForm.id,
            label: newMetadataForm.label,
            color: newMetadataForm.color,
          },
        };
        onObjectChange('metadataDict', newMetadataDict);
        setNewMetadataForm(null);
      }
    }
  };

  const handleRemoveMetadata = (metadataId: string) => {
    if (chartGroup) {
      const newMetadataDict = { ...chartGroup.metadataDict };
      delete newMetadataDict[metadataId];
      onObjectChange('metadataDict', newMetadataDict);
    }
  };

  const handleUpdateMetadata = (metadataId: string, updates: Partial<ChartMetadata>) => {
    if (chartGroup) {
      const newMetadataDict = {
        ...chartGroup.metadataDict,
        [metadataId]: {
          ...chartGroup.metadataDict[metadataId],
          ...updates,
        },
      };
      onObjectChange('metadataDict', newMetadataDict);
    }
  };

  const handleUpdateMetadataId = (oldId: string, newId: string) => {
    if (chartGroup && oldId !== newId) {
      const newMetadataDict = { ...chartGroup.metadataDict };
      // Copy the metadata with the new ID
      newMetadataDict[newId] = {
        ...chartGroup.metadataDict[oldId],
        id: newId,
      };
      // Remove the old entry
      delete newMetadataDict[oldId];
      onObjectChange('metadataDict', newMetadataDict);
    }
  };

  return (
    <>
      <BaseViewFields view={view} onChange={onChange} />

      <Form.Field label={<Trans>Title</Trans>} htmlFor="chart-title">
        <Form.Input
          id="chart-title"
          type="text"
          value={view.data.title || ''}
          onChange={(e) => onChange('data.title', e.target.value)}
        />
      </Form.Field>

      {chartGroup && (
        <>
          <Form.FieldGroup columns={2}>
            <Form.Field label={<Trans>Chart Group ID</Trans>} htmlFor="chart-id">
              <Form.Input
                id="chart-id"
                type="text"
                value={chartGroup.id}
                onChange={(e) => onObjectChange('id', e.target.value)}
              />
            </Form.Field>

            <Form.Field label={<Trans>Data Points</Trans>} htmlFor="data-points">
              <Form.Input
                id="data-points"
                type="text"
                value={`${chartGroup.data.length} ${chartGroup.data.length === 1 ? 'point' : 'points'}`}
                disabled
                className={styles.disabledField}
              />
            </Form.Field>
          </Form.FieldGroup>

          <Form.Field label={<Trans>Chart Group Label</Trans>} htmlFor="chart-label">
            <Form.Input
              id="chart-label"
              type="text"
              value={chartGroup.label}
              onChange={(e) => onObjectChange('label', e.target.value)}
            />
          </Form.Field>

          <Form.FieldSet>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <Form.Label>
                <Trans>Chart Series</Trans> ({metadataList.length})
              </Form.Label>
              <button
                type="button"
                onClick={handleAddMetadata}
                className={styles.iconButton}
                title="Add series"
              >
                <Plus size={16} />
              </button>
            </div>

            {newMetadataForm && (
              <div className={styles.seriesItem} style={{ border: '1px dashed #ccc', padding: '8px', marginBottom: '8px' }}>
                <input
                  type="color"
                  value={newMetadataForm.color}
                  onChange={(e) => setNewMetadataForm({ ...newMetadataForm, color: e.target.value })}
                  style={{ width: '32px', height: '32px', border: 'none' }}
                />
                <Form.Input
                  type="text"
                  placeholder="Series ID"
                  value={newMetadataForm.id}
                  onChange={(e) => setNewMetadataForm({ ...newMetadataForm, id: e.target.value })}
                  style={{ flex: 1 }}
                />
                <Form.Input
                  type="text"
                  placeholder="Series Label"
                  value={newMetadataForm.label}
                  onChange={(e) => setNewMetadataForm({ ...newMetadataForm, label: e.target.value })}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={handleAddMetadata}
                  className={styles.iconButton}
                  title="Confirm"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setNewMetadataForm(null)}
                  className={styles.iconButton}
                  title="Cancel"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}

            {metadataList.length > 0 ? (
              <div className={styles.seriesList}>
                {metadataList.map((meta) => (
                  <div key={meta.id} className={styles.seriesItem}>
                    <input
                      type="color"
                      value={meta.color || '#000000'}
                      onChange={(e) => handleUpdateMetadata(meta.id, { color: e.target.value })}
                      style={{ width: '24px', height: '24px', border: 'none', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingMetadataId === meta.id ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <Form.Input
                            type="text"
                            placeholder="ID"
                            value={meta.id}
                            onChange={(e) => handleUpdateMetadataId(meta.id, e.target.value)}
                            onBlur={() => setEditingMetadataId(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Escape') {
                                setEditingMetadataId(null);
                              }
                            }}
                            style={{ padding: '2px 4px', fontSize: '0.875rem' }}
                          />
                          <Form.Input
                            type="text"
                            placeholder="Label"
                            value={meta.label}
                            onChange={(e) => handleUpdateMetadata(meta.id, { label: e.target.value })}
                            onBlur={() => setEditingMetadataId(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === 'Escape') {
                                setEditingMetadataId(null);
                              }
                            }}
                            autoFocus
                            style={{ padding: '2px 4px', fontSize: '0.875rem' }}
                          />
                        </div>
                      ) : (
                        <span className={styles.seriesLabel}>
                          {meta.label}
                          <span className={styles.seriesId}> ({meta.id})</span>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingMetadataId(editingMetadataId === meta.id ? null : meta.id)}
                      className={styles.iconButton}
                      title="Edit"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveMetadata(meta.id)}
                      className={styles.iconButton}
                      title="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.infoText}>
                <Trans>No series available</Trans>
              </div>
            )}
          </Form.FieldSet>
        </>
      )}
    </>
  );
};
