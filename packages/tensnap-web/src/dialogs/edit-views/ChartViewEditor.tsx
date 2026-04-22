import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import Form from '@tensnap/web-common/components/ui/Form';
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

// 新系列表单组件
const NewSeriesForm: React.FC<{
  formData: { id: string; label: string; color: string };
  onUpdate: (updates: Partial<ChartMetadata>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ formData, onUpdate, onConfirm, onCancel }) => (
  <div className={styles.seriesItem} style={{ border: '1px dashed #ccc', padding: '8px', marginBottom: '8px' }}>
    <Form.Input
      type="color"
      value={formData.color}
      onChange={(e) => onUpdate({ color: e.target.value })}
      style={{ width: '32px', height: '32px', border: 'none' }}
    />
    <Form.Input
      type="text"
      placeholder="Series ID"
      value={formData.id}
      onChange={(e) => onUpdate({ id: e.target.value })}
      style={{ flex: 1 }}
    />
    <Form.Input
      type="text"
      placeholder="Series Label"
      value={formData.label}
      onChange={(e) => onUpdate({ label: e.target.value })}
      style={{ flex: 1 }}
    />
    <button type="button" onClick={onConfirm} className={styles.iconButton} title="Confirm">
      <Plus size={16} />
    </button>
    <button type="button" onClick={onCancel} className={styles.iconButton} title="Cancel">
      <Trash2 size={16} />
    </button>
  </div>
);

// 系列编辑表单组件
const SeriesEditForm: React.FC<{
  metadata: ChartMetadata;
  onUpdateLabel: (label: string) => void;
  onUpdateId: (id: string) => void;
  onBlur: () => void;
}> = ({ metadata, onUpdateLabel, onUpdateId, onBlur }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') onBlur();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <Form.Input
        type="text"
        placeholder="ID"
        value={metadata.id}
        onChange={(e) => onUpdateId(e.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        style={{ padding: '2px 4px', fontSize: '0.875rem' }}
      />
      <Form.Input
        type="text"
        placeholder="Label"
        value={metadata.label}
        onChange={(e) => onUpdateLabel(e.target.value)}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        autoFocus
        style={{ padding: '2px 4px', fontSize: '0.875rem' }}
      />
    </div>
  );
};

// 系列项组件
const SeriesItem: React.FC<{
  metadata: ChartMetadata;
  isEditing: boolean;
  onUpdateColor: (color: string) => void;
  onUpdateMetadata: (updates: Partial<ChartMetadata>) => void;
  onUpdateId: (newId: string) => void;
  onToggleEdit: () => void;
  onRemove: () => void;
}> = ({ metadata, isEditing, onUpdateColor, onUpdateMetadata, onUpdateId, onToggleEdit, onRemove }) => (
  <div className={styles.seriesItem}>
    <Form.Input
      type="color"
      value={metadata.color || '#000000'}
      onChange={(e) => onUpdateColor(e.target.value)}
      style={{ width: '24px', height: '24px', border: 'none', cursor: 'pointer' }}
    />
    <div style={{ flex: 1, minWidth: 0 }}>
      {isEditing ? (
        <SeriesEditForm
          metadata={metadata}
          onUpdateLabel={(label) => onUpdateMetadata({ label })}
          onUpdateId={onUpdateId}
          onBlur={onToggleEdit}
        />
      ) : (
        <span className={styles.seriesLabel}>
          {metadata.label}
          <span className={styles.seriesId}> ({metadata.id})</span>
        </span>
      )}
    </div>
    <button type="button" onClick={onToggleEdit} className={styles.iconButton} title="Edit">
      <Edit2 size={14} />
    </button>
    <button type="button" onClick={onRemove} className={styles.iconButton} title="Remove">
      <Trash2 size={14} />
    </button>
  </div>
);

// 系列列表组件
const SeriesList: React.FC<{
  metadataList: ChartMetadata[];
  editingId: string | null;
  onUpdateMetadata: (id: string, updates: Partial<ChartMetadata>) => void;
  onUpdateId: (oldId: string, newId: string) => void;
  onToggleEdit: (id: string) => void;
  onRemove: (id: string) => void;
}> = ({ metadataList, editingId, onUpdateMetadata, onUpdateId, onToggleEdit, onRemove }) => {
  if (metadataList.length === 0) {
    return (
      <div className={styles.infoText}>
        <Trans>No series available</Trans>
      </div>
    );
  }

  return (
    <div className={styles.seriesList}>
      {metadataList.map((meta) => (
        <SeriesItem
          key={meta.id}
          metadata={meta}
          isEditing={editingId === meta.id}
          onUpdateColor={(color) => onUpdateMetadata(meta.id, { color })}
          onUpdateMetadata={(updates) => onUpdateMetadata(meta.id, updates)}
          onUpdateId={(newId) => onUpdateId(meta.id, newId)}
          onToggleEdit={() => onToggleEdit(meta.id)}
          onRemove={() => onRemove(meta.id)}
        />
      ))}
    </div>
  );
};

// 主组件
export const ChartViewEditor: React.FC<ChartViewEditorProps> = ({ view, objectData: chartGroup, onChange, onObjectChange }) => {
  const [editingMetadataId, setEditingMetadataId] = useState<string | null>(null);
  const [newMetadataForm, setNewMetadataForm] = useState<{ id: string; label: string; color: string } | null>(null);

  const metadataList = chartGroup ? Object.values(chartGroup.metadataDict) : [];

  const handleAddMetadata = () => {
    if (!newMetadataForm) {
      setNewMetadataForm({
        id: `series-${generateUniqueId()}`,
        label: 'New Series',
        color: '#' + Math.floor(Math.random() * 16777215).toString(16),
      });
    } else if (chartGroup && newMetadataForm.id && newMetadataForm.label) {
      onObjectChange('metadataDict', {
        ...chartGroup.metadataDict,
        [newMetadataForm.id]: newMetadataForm,
      });
      setNewMetadataForm(null);
    }
  };

  const handleRemoveMetadata = (metadataId: string) => {
    if (!chartGroup) return;
    const newMetadataDict = { ...chartGroup.metadataDict };
    delete newMetadataDict[metadataId];
    onObjectChange('metadataDict', newMetadataDict);
  };

  const handleUpdateMetadata = (metadataId: string, updates: Partial<ChartMetadata>) => {
    if (!chartGroup) return;
    onObjectChange('metadataDict', {
      ...chartGroup.metadataDict,
      [metadataId]: { ...chartGroup.metadataDict[metadataId], ...updates },
    });
  };

  const handleUpdateMetadataId = (oldId: string, newId: string) => {
    if (!chartGroup || oldId === newId) return;
    const newMetadataDict = { ...chartGroup.metadataDict };
    newMetadataDict[newId] = { ...chartGroup.metadataDict[oldId], id: newId };
    delete newMetadataDict[oldId];
    onObjectChange('metadataDict', newMetadataDict);
  };

  const handleToggleEdit = (id: string) => {
    setEditingMetadataId(editingMetadataId === id ? null : id);
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
              <button type="button" onClick={handleAddMetadata} className={styles.iconButton} title="Add series">
                <Plus size={16} />
              </button>
            </div>

            {newMetadataForm && (
              <NewSeriesForm
                formData={newMetadataForm}
                onUpdate={(updates) => setNewMetadataForm({ ...newMetadataForm, ...updates })}
                onConfirm={handleAddMetadata}
                onCancel={() => setNewMetadataForm(null)}
              />
            )}

            <SeriesList
              metadataList={metadataList}
              editingId={editingMetadataId}
              onUpdateMetadata={handleUpdateMetadata}
              onUpdateId={handleUpdateMetadataId}
              onToggleEdit={handleToggleEdit}
              onRemove={handleRemoveMetadata}
            />
          </Form.FieldSet>
        </>
      )}
    </>
  );
};